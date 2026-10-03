/**
 * Visible assistant text must never dump raw tool XML / DSML.
 * Models sometimes emit `<|DSML| tool_search …>` as a text part instead
 * of a typed tool call — strip that for the transcript and recover the
 * tool name so status can stay honest.
 */

export type RecoveredToolCall = {
  toolName: string;
  args: Record<string, unknown>;
};

const DSML_TAG = /<\s*\/?\s*\|\s*\/?\s*DSML\s*\|[^>]*>/gi;
const DSML_BLOCK =
  /<\s*\|\s*DSML\s*\|[\s\S]*?(?:<\s*\/?\s*\|\s*\/?\s*DSML\s*\|[^>]*>|$)/gi;

const TOOL_XML_BLOCK =
  /<\/?(?:tool_call|function_call|invoke|tool_calls)\b[^>]*>/gi;

const RECOVER_TOOL =
  /(?:tool_name|name|tool)\s*[:=]\s*["']?([a-zA-Z_][\w]*)|([a-zA-Z_][\w]*)\s+(?:query|q|url|title)\s*=/i;

const ARG_PAIR = /([a-zA-Z_][\w]*)\s*=\s*"([^"]*)"/g;

function asText(text: unknown): string {
  return typeof text === "string" ? text : "";
}

export function looksLikeRawToolMarkup(text: unknown): boolean {
  const value = asText(text);
  if (!value) return false;
  return (
    /<\s*\|\s*DSML\s*\|/i.test(value) ||
    /<\/\s*\|\s*DSML\s*\|/i.test(value) ||
    /<(?:tool_call|function_call|invoke)\b/i.test(value)
  );
}

export function recoverToolCallsFromMarkup(text: unknown): RecoveredToolCall[] {
  const value = asText(text);
  if (!value || !looksLikeRawToolMarkup(value)) return [];
  const found: RecoveredToolCall[] = [];
  const seen = new Set<string>();

  const interiors = [
    ...value.matchAll(/<\s*\/?\s*\|\s*\/?\s*DSML\s*\|([^>]*)>/gi),
  ].map((m) => m[1] ?? "");
  const haystacks = interiors.length > 0 ? interiors : [value];

  for (const chunk of haystacks) {
    const named = chunk.match(RECOVER_TOOL);
    const toolName = (named?.[1] || named?.[2] || "").trim();
    if (!toolName) continue;
    const args: Record<string, unknown> = {};
    for (const match of chunk.matchAll(ARG_PAIR)) {
      args[match[1]] = match[2];
    }
    if (Object.keys(args).length === 0 && !named?.[1]) continue;
    const key = `${toolName}:${String(args.query ?? args.url ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ toolName, args });
  }
  return found;
}

/** Prose only — raw DSML / tool XML removed. Ordinary markdown is left intact. */
export function sanitizeVisibleAssistantText(text: unknown): string {
  const value = asText(text);
  if (!value) return "";
  if (!looksLikeRawToolMarkup(value)) return value.trim() ? value : "";
  let next = value.replace(DSML_BLOCK, " ");
  next = next.replace(DSML_TAG, " ");
  next = next.replace(TOOL_XML_BLOCK, " ");
  next = next.replace(/<\s*\|\s*\/?\s*DSML[\s\S]*/gi, " ");
  next = next.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return next;
}

export function isHiddenToolMarkup(text: unknown): boolean {
  const value = asText(text);
  if (!looksLikeRawToolMarkup(value)) return false;
  return sanitizeVisibleAssistantText(value).length === 0;
}

const SYSTEM_LINE = /^\s*(?:system|developer)\s*:\s*[^\n]*$/gim;
const SYSTEM_TAG = /<\s*\/?\s*system\b[^>]*>/gi;

function looksLikeToolPayload(blob: string): boolean {
  return /"(?:toolName|tool_name|arguments|function_call)"\s*:/.test(blob);
}

function isJsonBlob(value: string): boolean {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

/** End index after a JSON object/array, or -1 when the slice is not closed. */
function scanJsonEnd(value: string, start: number): number {
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < value.length; i++) {
    const ch = value[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open || ch === "{" || ch === "[") depth++;
    else if (ch === close || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function stripToolJsonBlobs(value: string): string {
  if (isJsonBlob(value) && looksLikeToolPayload(value.trim())) return "";
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch !== "{" && ch !== "[") {
      out += ch;
      continue;
    }
    const end = scanJsonEnd(value, i);
    if (end < 0) {
      out += ch;
      continue;
    }
    const blob = value.slice(i, end);
    if (looksLikeToolPayload(blob)) {
      i = end - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Reasoning shown inside the collapsed disclosure.
 * Reuses the visible-text strip, then drops system lines and tool JSON.
 */
export function sanitizeReasoningText(text: unknown): string {
  let value = sanitizeVisibleAssistantText(text);
  if (!value) return "";
  value = value.replace(SYSTEM_TAG, " ");
  value = value.replace(SYSTEM_LINE, " ");
  value = stripToolJsonBlobs(value);
  value = value
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return value;
}
