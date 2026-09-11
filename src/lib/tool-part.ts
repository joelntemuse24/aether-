/** Normalize assistant-ui + AI SDK tool parts so failed history cannot throw. */

export type ToolPartLike = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  status?: { type?: string };
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function toToolPartLike(part: unknown): ToolPartLike | null {
  const rec = asRecord(part);
  const type = typeof rec.type === "string" ? rec.type : "";
  if (type === "text" || type === "reasoning" || type === "source" || type === "step-start") {
    return null;
  }
  let toolName = typeof rec.toolName === "string" ? rec.toolName.trim() : "";
  if (!toolName && type.startsWith("tool-") && type !== "tool-call") {
    toolName = type.slice("tool-".length);
  }
  if (!toolName || toolName === "call" || toolName === "result" || toolName === "invocation") {
    return null;
  }
  const state = typeof rec.state === "string" ? rec.state : "";
  const errorText = typeof rec.errorText === "string" ? rec.errorText : "";
  const status =
    rec.status && typeof rec.status === "object" && !Array.isArray(rec.status)
      ? (rec.status as { type?: string })
      : state === "output-error"
        ? { type: "incomplete" }
        : state === "output-available" || state === "output-denied"
          ? { type: "complete" }
          : undefined;
  return {
    toolCallId:
      typeof rec.toolCallId === "string" && rec.toolCallId
        ? rec.toolCallId
        : `tool-${toolName}`,
    toolName,
    args: rec.args ?? rec.input,
    argsText: typeof rec.argsText === "string" ? rec.argsText : undefined,
    result: rec.result ?? rec.output,
    isError:
      rec.isError === true ||
      state === "output-error" ||
      errorText.length > 0,
    status,
  };
}

export function safeStringifyToolResult(result: unknown): string {
  if (result === undefined) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2) ?? "";
  } catch {
    return "Result unavailable.";
  }
}
