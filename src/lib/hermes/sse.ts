/**
 * Minimal SSE parser for Hermes OpenAI-compatible streams.
 * Supports unnamed `data:` frames and named `event:` + `data:` pairs.
 */

export type HermesSseFrame = {
  event: string;
  data: string;
};

/**
 * Parse a complete SSE buffer chunk into frames.
 * Leaves any incomplete trailing segment in `rest`.
 */
export function consumeSseBuffer(buffer: string): {
  frames: HermesSseFrame[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: HermesSseFrame[] = [];

  for (const block of parts) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":") || line.trim() === "") continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) continue;
    frames.push({ event, data: dataLines.join("\n") });
  }

  return { frames, rest };
}

export type OpenAIToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export type ChatCompletionDelta = {
  content?: string | null;
  role?: string;
  tool_calls?: OpenAIToolCallDelta[];
};

export type ChatCompletionChunk = {
  id?: string;
  object?: string;
  choices?: Array<{
    index?: number;
    delta?: ChatCompletionDelta;
    finish_reason?: string | null;
  }>;
};

export type HermesToolProgress = {
  tool?: string;
  name?: string;
  tool_name?: string;
  status?: string;
  phase?: string;
  call_id?: string;
  tool_call_id?: string;
  id?: string;
  arguments?: unknown;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  message?: string;
};

export function parseChatCompletionChunk(
  data: string,
): ChatCompletionChunk | null {
  if (data === "[DONE]") return null;
  try {
    return JSON.parse(data) as ChatCompletionChunk;
  } catch {
    return null;
  }
}

export function parseHermesToolProgress(
  data: string,
): HermesToolProgress | null {
  try {
    return JSON.parse(data) as HermesToolProgress;
  } catch {
    return null;
  }
}

export function contentDeltaFromChunk(chunk: ChatCompletionChunk): string {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta || typeof delta.content !== "string") return "";
  return delta.content;
}

export function toolNameFromProgress(p: HermesToolProgress): string {
  return (
    p.tool_name ||
    p.name ||
    p.tool ||
    "tool"
  ).toString();
}

export function toolCallIdFromProgress(
  p: HermesToolProgress,
  fallback: string,
): string {
  const id = p.tool_call_id || p.call_id || p.id;
  return id ? String(id) : fallback;
}

export function isToolProgressDone(p: HermesToolProgress): boolean {
  const s = (p.status || p.phase || "").toLowerCase();
  return (
    s === "done" ||
    s === "completed" ||
    s === "complete" ||
    s === "success" ||
    s === "finished" ||
    p.output !== undefined ||
    p.result !== undefined
  );
}

export type AccumulatedToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/** Merge streamed OpenAI tool_calls deltas into complete calls. */
export function accumulateToolCallDeltas(
  acc: AccumulatedToolCall[],
  deltas: OpenAIToolCallDelta[] | undefined,
): AccumulatedToolCall[] {
  if (!deltas?.length) return acc;
  const next = [...acc];
  for (const delta of deltas) {
    const index = typeof delta.index === "number" ? delta.index : next.length;
    const current = next[index] ?? { id: "", name: "", arguments: "" };
    next[index] = {
      id: delta.id || current.id,
      name: delta.function?.name || current.name,
      arguments: current.arguments + (delta.function?.arguments ?? ""),
    };
  }
  return next;
}

export function parsedToolCallArguments(
  raw: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}
