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

export function looksLikeRawToolMarkup(text: string): boolean {
  if (!text) return false;
  return (
    /<\s*\|\s*DSML\s*\|/i.test(text) ||
    /<\/\s*\|\s*DSML\s*\|/i.test(text) ||
    /<(?:tool_call|function_call|invoke)\b/i.test(text)
  );
}

export function recoverToolCallsFromMarkup(text: string): RecoveredToolCall[] {
  if (!text || !looksLikeRawToolMarkup(text)) return [];
  const found: RecoveredToolCall[] = [];
  const seen = new Set<string>();

  const interiors = [
    ...text.matchAll(/<\s*\/?\s*\|\s*\/?\s*DSML\s*\|([^>]*)>/gi),
  ].map((m) => m[1] ?? "");
  const haystacks = interiors.length > 0 ? interiors : [text];

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

/** Prose only — raw DSML / tool XML removed. Empty when the part was markup. */
export function sanitizeVisibleAssistantText(text: string): string {
  if (!text) return "";
  let next = text.replace(DSML_BLOCK, " ");
  next = next.replace(DSML_TAG, " ");
  next = next.replace(TOOL_XML_BLOCK, " ");
  next = next.replace(/<\s*\|\s*\/?\s*DSML[\s\S]*/gi, " ");
  next = next.replace(/\s+/g, " ").trim();
  return next;
}

export function isHiddenToolMarkup(text: string): boolean {
  if (!looksLikeRawToolMarkup(text)) return false;
  return sanitizeVisibleAssistantText(text).length === 0;
}
