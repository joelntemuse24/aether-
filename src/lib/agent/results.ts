/**
 * Tool results the model sees. Failures stay inside the loop as data.
 */

export type ToolSuccess<T = unknown> = {
  ok: true;
  data: T;
  truncated?: boolean;
};

export type ToolFailure = {
  ok: false;
  error: string;
  retryable: boolean;
};

export type ToolResult<T = unknown> = ToolSuccess<T> | ToolFailure;

/** Cap before a tool payload is sent back to the model. */
export const DEFAULT_TOOL_RESULT_CHARS = 16_000;

export function toolOk<T>(data: T): ToolSuccess<T> {
  return { ok: true, data };
}

export function toolError(error: string, retryable = false): ToolFailure {
  return { ok: false, error, retryable };
}

export function isToolResult(value: unknown): value is ToolResult {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  return typeof (value as { ok?: unknown }).ok === "boolean";
}

export function asToolResult(value: unknown): ToolResult {
  if (isToolResult(value)) return value;
  return toolOk(value);
}

/**
 * Keep a tool payload under `maxChars`. The model receives a preview instead
 * of the raw body when the JSON does not fit.
 */
function capped(result: ToolResult, preview: string): ToolResult {
  if (!result.ok) return toolError(`Tool result truncated. ${preview}`, result.retryable);
  return { ok: true, truncated: true, data: { truncated: true, preview } };
}

export function capToolResult(result: ToolResult, maxChars = DEFAULT_TOOL_RESULT_CHARS): ToolResult {
  if (JSON.stringify(result).length <= maxChars) return result;
  let preview = JSON.stringify(result).slice(0, Math.max(0, maxChars));
  let next = capped(result, preview);
  while (JSON.stringify(next).length > maxChars && preview.length > 0) {
    preview = preview.slice(0, Math.max(0, preview.length - 32));
    next = capped(result, preview);
  }
  if (JSON.stringify(next).length > maxChars) {
    return result.ok
      ? { ok: true, truncated: true, data: { truncated: true, preview: "" } }
      : toolError("Tool result truncated.", result.retryable);
  }
  return next;
}
