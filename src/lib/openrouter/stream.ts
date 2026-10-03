import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { DEFAULT_OPENROUTER_BASE_URL } from "@/lib/trueforge/providers";
import { redactSecret } from "./models";
import { textFromOpenRouterSse } from "./sse";
import type { UiChunk } from "@/lib/trueforge/ui-chunks";

export function shouldBackupBuzzWithOpenRouter(input: {
  failedBeforeOutput: boolean;
  userAborted: boolean;
  hasKey: boolean;
}): boolean {
  return input.failedBeforeOutput && !input.userAborted && input.hasKey;
}

export async function writeOpenRouterAnswer(input: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  write: (chunk: UiChunk) => void;
  abortSignal?: AbortSignal;
  statusLine?: string;
}): Promise<{ ok: boolean; errorText: string }> {
  if (input.statusLine) {
    input.write({ type: "text-start", id: "or-status" });
    input.write({ type: "text-delta", id: "or-status", delta: input.statusLine });
    input.write({ type: "text-end", id: "or-status" });
  }
  let response: Response;
  try {
    response = await fetch(`${DEFAULT_OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          { role: "user", content: input.userText },
        ],
      }),
      signal: input.abortSignal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The provider had an error.";
    return { ok: false, errorText: redactSecret(message, input.apiKey) };
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      errorText: redactSecret(`OpenRouter request failed (${response.status}). ${detail}`.trim(), input.apiKey),
    };
  }
  input.write({ type: "text-start", id: "or-answer" });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let wrote = false;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      pending += decoder.decode(step.value, { stream: true });
      const parts = pending.split("\n\n");
      pending = parts.pop() ?? "";
      for (const part of parts) {
        const delta = textFromOpenRouterSse(part);
        if (!delta) continue;
        wrote = true;
        input.write({ type: "text-delta", id: "or-answer", delta });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The provider had an error.";
    input.write({ type: "text-end", id: "or-answer" });
    return { ok: false, errorText: redactSecret(message, input.apiKey) };
  }
  input.write({ type: "text-end", id: "or-answer" });
  if (!wrote) return { ok: false, errorText: "The provider returned an empty answer." };
  return { ok: true, errorText: "" };
}

export function openRouterChatResponse(input: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  abortSignal?: AbortSignal;
  statusLine?: string;
}): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UiChunk) => {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      };
      writer.write({ type: "start" });
      const outcome = await writeOpenRouterAnswer({ ...input, write });
      if (!outcome.ok) {
        write({ type: "error", errorText: outcome.errorText });
      }
      writer.write({ type: "finish", finishReason: outcome.ok ? "stop" : "error" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
