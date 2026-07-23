import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";

export const maxDuration = 60;
export const runtime = "nodejs";

type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

function getHeader(req: Request, name: string): string {
  return req.headers.get(name)?.trim() ?? "";
}

function resolveModel(provider: ProviderId, model: string): string {
  // Direct Anthropic SDK expects bare model ids (no "anthropic/" prefix)
  if (provider === "anthropic") {
    return model.replace(/^anthropic\//, "");
  }
  // OpenAI-compatible routes (OpenRouter, OpenAI, custom) accept full ids
  if (provider === "openai") {
    return model.replace(/^openai\//, "");
  }
  return model;
}

export async function POST(req: Request) {
  try {
    const apiKey = getHeader(req, "x-api-key");
    const provider = (getHeader(req, "x-provider") || "openrouter") as ProviderId;
    const baseURL = getHeader(req, "x-base-url");
    const headerModel = getHeader(req, "x-model");

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error:
            "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const messages = body.messages as UIMessage[];
    const system =
      typeof body.system === "string" && body.system.length <= 8000
        ? body.system
        : undefined;
    const modelId = resolveModel(
      provider,
      (typeof body.model === "string" && body.model) || headerModel || "anthropic/claude-sonnet-4",
    );

    let model;
    if (provider === "anthropic") {
      const anthropic = createAnthropic({ apiKey });
      model = anthropic(modelId);
    } else {
      const openai = createOpenAI({
        apiKey,
        baseURL:
          baseURL ||
          (provider === "openrouter"
            ? "https://openrouter.ai/api/v1"
            : provider === "openai"
              ? "https://api.openai.com/v1"
              : baseURL),
        headers:
          provider === "openrouter"
            ? {
                "HTTP-Referer":
                  req.headers.get("origin") ?? "http://localhost:3000",
                "X-Title": "Aether",
              }
            : undefined,
      });
      model = openai.chat(modelId);
    }

    const result = streamText({
      model,
      messages: await convertToModelMessages(messages),
      ...(system ? { system } : {}),
      maxOutputTokens: 8192,
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        console.error("[api/chat]", error);
        if (error instanceof Error) return error.message;
        return "An error occurred while generating a response.";
      },
    });
  } catch (error) {
    console.error("[api/chat]", error);
    const message =
      error instanceof Error ? error.message : "Request failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
