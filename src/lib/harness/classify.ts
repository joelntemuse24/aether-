import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, type LanguageModel } from "ai";
import { createHostedLanguageModel } from "@/lib/hosted/client";
import { heuristicClassify } from "./heuristic";
import {
  classificationSchema,
  type HarnessClassification,
} from "./types";

type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

function resolveModel(provider: ProviderId, model: string): string {
  if (provider === "anthropic") return model.replace(/^anthropic\//, "");
  if (provider === "openai") return model.replace(/^openai\//, "");
  return model;
}

function buildByokModel(input: {
  provider: ProviderId;
  apiKey: string;
  baseURL?: string;
  modelId: string;
  origin?: string | null;
}): LanguageModel {
  const modelId = resolveModel(input.provider, input.modelId);
  if (input.provider === "anthropic") {
    return createAnthropic({ apiKey: input.apiKey })(modelId);
  }
  const openai = createOpenAI({
    apiKey: input.apiKey,
    baseURL:
      input.baseURL ||
      (input.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : input.provider === "openai"
          ? "https://api.openai.com/v1"
          : input.baseURL),
    headers:
      input.provider === "openrouter"
        ? {
            "HTTP-Referer": input.origin ?? "http://localhost:3000",
            "X-Title": "Aether",
          }
        : undefined,
  });
  return openai.chat(modelId);
}

const CLASSIFIER_SYSTEM = `You classify the user's latest message for Aether's agent harness.

Return JSON only matching the schema.
- intent: primary job (chat, research, write, life_admin, study, code, other)
- depth: shallow (greetings / yes-no / tiny), standard (normal help), deep (research, study, serious writing, multi-step life admin)
- needsClarify: true only when a short A/B (or few-option) question would materially change the approach. Do NOT clarify when the ask is already clear.
- questions: 1–2 max when needsClarify; each should have 2–4 concrete options when possible
- planSteps: 2–5 short steps when depth is deep; otherwise omit
Be conservative with needsClarify — prefer acting when reasonable.`;

/**
 * Classify a user message. Falls back to heuristics if the model call fails.
 */
export async function classifyMessage(input: {
  message: string;
  accessMode?: "hosted" | "byok";
  apiKey: string;
  provider: ProviderId;
  baseURL?: string;
  modelId: string;
  origin?: string | null;
}): Promise<HarnessClassification> {
  const trimmed = input.message.trim();
  if (!trimmed) {
    return heuristicClassify("");
  }

  const hosted = input.accessMode === "hosted";
  if (!input.modelId || (!hosted && !input.apiKey)) {
    return heuristicClassify(trimmed);
  }

  try {
    const model = hosted
      ? createHostedLanguageModel(input.modelId, input.origin)
      : buildByokModel({
          provider: input.provider,
          apiKey: input.apiKey,
          baseURL: input.baseURL,
          modelId: input.modelId,
          origin: input.origin,
        });
    if (!model) {
      return heuristicClassify(trimmed);
    }

    const { object } = await generateObject({
      model,
      schema: classificationSchema,
      schemaName: "HarnessClassification",
      system: CLASSIFIER_SYSTEM,
      prompt: trimmed.slice(0, 4000),
      maxOutputTokens: 600,
    });

    const parsed = classificationSchema.parse(object);
    if (parsed.needsClarify && parsed.questions.length === 0) {
      return { ...parsed, needsClarify: false };
    }
    if (!parsed.needsClarify) {
      return { ...parsed, questions: [] };
    }
    return parsed;
  } catch (err) {
    console.warn("[harness/classify] model failed, using heuristic", err);
    return heuristicClassify(trimmed);
  }
}
