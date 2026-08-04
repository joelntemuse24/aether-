/**
 * Repair common LLM tool-argument JSON failures before schema validation.
 *
 * Claude (and others) sometimes emit two back-to-back objects in one tool call:
 *   {"path":"a.py","repo":"o/r"}{"path":"b.py","repo":"o/r"}
 * or an array of objects when the schema expects a single object.
 * Taking the first complete value unblocks the call; the model can read the
 * rest on the next step / via parallel tool calls.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function tryParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Strip ``` / ```json fences models sometimes wrap around tool args. */
export function stripJsonCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * Return the first complete JSON value (object or array) in `text`, or null.
 * String-aware brace/bracket scanner — stops at the first top-level close.
 */
export function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

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
    if (ch === "{" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
      if (depth < 0) return null;
    }
  }

  return null;
}

/**
 * If `raw` is invalid / multi-object tool JSON, return a repaired single-object
 * JSON string. Returns null when no safe repair applies (leave schema errors alone).
 */
export function repairToolCallInputJson(raw: string): string | null {
  const text = stripJsonCodeFences(String(raw ?? ""));
  if (!text) return null;

  const whole = tryParse(text);
  if (whole !== undefined) {
    // Schema expects one object; models sometimes pass [{...},{...}].
    if (Array.isArray(whole) && whole.length > 0 && isPlainObject(whole[0])) {
      return JSON.stringify(whole[0]);
    }
    return null;
  }

  const firstText = extractFirstJsonValue(text);
  if (!firstText) return null;

  const first = tryParse(firstText);
  if (first === undefined) return null;

  if (Array.isArray(first) && first.length > 0 && isPlainObject(first[0])) {
    return JSON.stringify(first[0]);
  }
  if (isPlainObject(first)) {
    return JSON.stringify(first);
  }
  return null;
}
