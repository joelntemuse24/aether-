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

type IncomingAttachment = {
  name: string;
  mime: string;
  dataUrl: string;
};

function getHeader(req: Request, name: string): string {
  return req.headers.get(name)?.trim() ?? "";
}

function resolveModel(provider: ProviderId, model: string): string {
  if (provider === "anthropic") {
    return model.replace(/^anthropic\//, "");
  }
  if (provider === "openai") {
    return model.replace(/^openai\//, "");
  }
  return model;
}

/** Inject image parts + optional text prefix into the last user message. */
function enrichMessagesWithAttachments(
  messages: UIMessage[],
  attachments: IncomingAttachment[],
  textPrefix?: string,
): UIMessage[] {
  if ((!attachments || attachments.length === 0) && !textPrefix) {
    return messages;
  }

  // Find the last user message
  const lastUserIdx = [...messages]
    .map((m, i) => ({ m, i }))
    .reverse()
    .find(({ m }) => m.role === "user")?.i;

  if (lastUserIdx === undefined) return messages;

  const original = messages[lastUserIdx];
  const existingParts: UIMessage["parts"] = Array.isArray(original.parts)
    ? [...original.parts]
    : [];

  // Prepend text prefix if present
  if (textPrefix) {
    const firstTextIdx = existingParts.findIndex((p) => p.type === "text");
    if (firstTextIdx >= 0) {
      const part = existingParts[firstTextIdx] as { type: "text"; text: string };
      existingParts[firstTextIdx] = {
        type: "text",
        text: textPrefix + (part.text || ""),
      };
    } else {
      existingParts.unshift({ type: "text", text: textPrefix });
    }
  }

  // Append image parts (data URLs)
  for (const att of attachments) {
    existingParts.push({
      type: "file",
      mediaType: att.mime,
      url: att.dataUrl,
      filename: att.name,
    } as UIMessage["parts"][number]);
  }

  const enriched: UIMessage = {
    ...original,
    parts: existingParts,
  };

  const next = [...messages];
  next[lastUserIdx] = enriched;
  return next;
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
      (typeof body.model === "string" && body.model) || headerModel,
    );

    const attachments = (body.attachments || []) as IncomingAttachment[];
    const textPrefix =
      typeof body.textPrefix === "string" ? body.textPrefix : undefined;

    if (!modelId) {
      return new Response(
        JSON.stringify({ error: "No model selected. Pick a model from the dropdown." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

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

    const enrichedMessages = enrichMessagesWithAttachments(
      messages,
      attachments,
      textPrefix,
    );

    const result = streamText({
      model,
      messages: await convertToModelMessages(enrichedMessages),
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
