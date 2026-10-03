/**
 * Per-turn UI chunks the thread already renders, plus ids for resume.
 */

import type { UiChunk } from "@/lib/trueforge/ui-chunks";
import { sanitizeVisibleAssistantText } from "@/lib/visible-chat-text";

export type AgentEvent = {
  id: string;
  chunk: UiChunk;
};

export type AgentEventLog = {
  push: (chunk: UiChunk) => AgentEvent;
  since: (lastId: string | null | undefined) => AgentEvent[];
  all: () => AgentEvent[];
};

export function createAgentEventLog(): AgentEventLog {
  const events: AgentEvent[] = [];
  let next = 0;
  return {
    push(chunk) {
      next += 1;
      const event = { id: String(next), chunk };
      events.push(event);
      return event;
    },
    since(lastId) {
      if (!lastId) return [...events];
      const index = events.findIndex((event) => event.id === lastId);
      if (index < 0) return [...events];
      return events.slice(index + 1);
    },
    all() {
      return [...events];
    },
  };
}

function deltaOf(chunk: UiChunk): string {
  if (typeof chunk.delta === "string") return chunk.delta;
  if (typeof chunk.text === "string") return chunk.text;
  return "";
}

export function visibleTextFromChunks(chunks: readonly UiChunk[]): string {
  let text = "";
  for (const chunk of chunks) {
    if (chunk.type === "text-delta") text += deltaOf(chunk);
  }
  return sanitizeVisibleAssistantText(text);
}

export function visibleTextFromEvents(events: readonly { chunk: UiChunk }[]): string {
  return visibleTextFromChunks(events.map((event) => event.chunk));
}

/** Drop leaked tool markup from text parts. Other chunks pass through. */
export function sanitizeUiChunks(chunks: readonly UiChunk[]): UiChunk[] {
  const out: UiChunk[] = [];
  let open = false;
  let id = "text";
  let buf = "";

  const flush = () => {
    if (!open) return;
    const clean = sanitizeVisibleAssistantText(buf);
    if (clean) {
      out.push({ type: "text-start", id });
      out.push({ type: "text-delta", id, delta: clean });
      out.push({ type: "text-end", id });
    }
    open = false;
    buf = "";
  };

  for (const chunk of chunks) {
    if (chunk.type === "text-start") {
      flush();
      open = true;
      id = typeof chunk.id === "string" && chunk.id ? chunk.id : "text";
      buf = "";
      continue;
    }
    if (chunk.type === "text-delta" && open) {
      buf += deltaOf(chunk);
      continue;
    }
    if (chunk.type === "text-end") {
      flush();
      continue;
    }
    flush();
    out.push(chunk);
  }
  flush();
  return out;
}

/** Append a visible sentence when the turn would otherwise end with no text. */
export function withFinalText(chunks: readonly UiChunk[], text: string): UiChunk[] {
  const sanitized = sanitizeUiChunks(chunks);
  if (visibleTextFromChunks(sanitized).length > 0) return sanitized;
  const sentence = text.trim();
  if (!sentence) return sanitized;
  const id = "agent-final";
  const kept = sanitized.filter((chunk) => chunk.type !== "error");
  return [
    ...kept,
    { type: "text-start", id },
    { type: "text-delta", id, delta: sentence },
    { type: "text-end", id },
  ];
}
