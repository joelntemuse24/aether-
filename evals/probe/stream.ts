import { consumeSseBuffer } from "../../src/lib/hermes/sse";
import { sanitizeVisibleAssistantText } from "../../src/lib/visible-chat-text";
import { countWorkingStrips } from "./detectors";

export type ParsedChatStream = {
  visibleText: string;
  rawText: string;
  eventTypes: string[];
  finished: boolean;
  errorText: string | null;
  workingStripCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function collectTextDelta(rec: Record<string, unknown>): string {
  return (
    str(rec.delta) ||
    str(rec.text) ||
    str(rec.errorText) ||
    str(rec.errorMessage) ||
    str(rec.error)
  );
}

/**
 * Fold a UIMessage / Trigger SSE body (or a JSON error) into a transcript.
 */
export function parseChatResponseBody(body: string): ParsedChatStream {
  const eventTypes: string[] = [];
  const rawChunks: string[] = [];
  let finished = false;
  let errorText: string | null = null;

  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed) as unknown;
      const rec = asRecord(json);
      if (rec) {
        const err = str(rec.error) || str(rec.message);
        if (err) errorText = err;
        const text = str(rec.text) || str(rec.content);
        if (text) rawChunks.push(text);
        eventTypes.push("json");
      }
    } catch {
      rawChunks.push(trimmed);
    }
  }

  const { frames } = consumeSseBuffer(`${body}\n\n`);
  for (const frame of frames) {
    if (frame.data === "[DONE]") {
      finished = true;
      eventTypes.push("done");
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      if (frame.data.trim()) rawChunks.push(frame.data);
      continue;
    }
    const rec = asRecord(parsed);
    if (!rec) continue;
    const type = str(rec.type) || frame.event || "message";
    eventTypes.push(type);
    if (type === "finish" || type === "finish-step") finished = true;
    if (type === "error" || type === "tool-output-error") {
      const err = collectTextDelta(rec) || "stream error";
      errorText = errorText ? `${errorText}\n${err}` : err;
    }
    const delta = collectTextDelta(rec);
    if (delta) rawChunks.push(delta);
  }

  const rawText = rawChunks.join("");
  const visibleText = sanitizeVisibleAssistantText(rawText);
  return {
    visibleText,
    rawText,
    eventTypes,
    finished,
    errorText,
    workingStripCount: countWorkingStrips(rawText) || countWorkingStrips(visibleText),
  };
}
