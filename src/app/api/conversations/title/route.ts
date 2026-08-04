import { NextResponse } from "next/server";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel } from "ai";
import {
  fallbackConversationTitle,
  sanitizeModelTitle,
} from "@/lib/conversation-title";
import { createHostedLanguageModel } from "@/lib/hosted/client";
import { isHostedConfigured } from "@/lib/hosted/config";

export const runtime = "nodejs";
export const maxDuration = 45;

type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

function getHeader(req: Request, name: string): string {
  return req.headers.get(name)?.trim() ?? "";
}

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

const TITLE_SYSTEM = `Name this chat in 3–7 words.
Return ONLY the title — no quotes, no punctuation at the ends, no "Title:".
Capture the user's aim (e.g. "GCP memory issues", "Repo code review", "Q3 revenue brief"), not a verbatim clip of their first words.`;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const message = typeof body.message === "string" ? body.message : "";
  const fallback = fallbackConversationTitle(message);

  if (!message.trim()) {
    return NextResponse.json({ title: "New chat", source: "empty" });
  }

  try {
    const accessMode = getHeader(req, "x-access-mode") || "byok";
    const apiKey = getHeader(req, "x-api-key");
    const provider = (getHeader(req, "x-provider") || "openrouter") as ProviderId;
    const baseURL = getHeader(req, "x-base-url");
    const modelId = getHeader(req, "x-model");
    const hosted = accessMode === "hosted";

    if (hosted && !isHostedConfigured()) {
      return NextResponse.json({ title: fallback, source: "fallback" });
    }
    if (!hosted && (!apiKey || !modelId)) {
      return NextResponse.json({ title: fallback, source: "fallback" });
    }

    let model: LanguageModel;
    if (hosted) {
      const preferred =
        modelId && /gpt|chatgpt|sol/i.test(modelId)
          ? modelId
          : modelId || "gpt-5.6-sol";
      const hostedModel = createHostedLanguageModel(
        preferred,
        req.headers.get("origin"),
      );
      if (!hostedModel) {
        return NextResponse.json({ title: fallback, source: "fallback" });
      }
      model = hostedModel;
    } else {
      model = buildByokModel({
        provider,
        apiKey,
        baseURL: baseURL || undefined,
        modelId,
        origin: req.headers.get("origin"),
      });
    }

    const result = await generateText({
      model,
      system: TITLE_SYSTEM,
      prompt: message.slice(0, 2000),
      maxOutputTokens: 40,
      abortSignal: AbortSignal.timeout(12_000),
    });

    const title = sanitizeModelTitle(result.text || "", fallback);
    return NextResponse.json({ title, source: "model" });
  } catch (err) {
    console.warn("[api/conversations/title]", err);
    return NextResponse.json({ title: fallback, source: "fallback" });
  }
}
