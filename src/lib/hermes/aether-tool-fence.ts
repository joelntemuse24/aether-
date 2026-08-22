export const AETHER_TOOL_FENCE_OPEN = "[[aether_tool]]";
export const AETHER_TOOL_FENCE_CLOSE = "[[/aether_tool]]";

export type ParsedAetherToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export function parseAetherToolFencePayload(
  raw: string,
): ParsedAetherToolCall | null {
  try {
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      arguments?: unknown;
      args?: unknown;
    };
    if (typeof parsed.name !== "string" || !parsed.name.trim()) return null;
    const args = parsed.arguments ?? parsed.args ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) return null;
    return {
      name: parsed.name.trim(),
      arguments: args as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/**
 * Incremental fence scanner. Incomplete fences stay in `rest` so the
 * stream can hold tokens until the closing marker arrives.
 */
export function consumeAetherToolFences(buffer: string): {
  visible: string;
  calls: ParsedAetherToolCall[];
  rest: string;
} {
  let cursor = 0;
  let visible = "";
  const calls: ParsedAetherToolCall[] = [];

  while (cursor < buffer.length) {
    const open = buffer.indexOf(AETHER_TOOL_FENCE_OPEN, cursor);
    if (open < 0) {
      visible += buffer.slice(cursor);
      cursor = buffer.length;
      break;
    }
    visible += buffer.slice(cursor, open);
    const afterOpen = open + AETHER_TOOL_FENCE_OPEN.length;
    const close = buffer.indexOf(AETHER_TOOL_FENCE_CLOSE, afterOpen);
    if (close < 0) {
      return {
        visible,
        calls,
        rest: buffer.slice(open),
      };
    }
    const payload = buffer.slice(afterOpen, close).trim();
    const parsed = parseAetherToolFencePayload(payload);
    if (parsed) calls.push(parsed);
    cursor = close + AETHER_TOOL_FENCE_CLOSE.length;
  }

  return { visible, calls, rest: "" };
}

export function formatAetherToolResultsForModel(
  results: Array<{ name: string; output: unknown }>,
): string {
  const lines = [
    "Aether tool results (already executed). Use them. Do not re-call the same tool unless you need a different query.",
  ];
  for (const row of results) {
    let body: string;
    try {
      body = JSON.stringify(row.output);
    } catch {
      body = String(row.output);
    }
    lines.push(`- ${row.name}: ${body}`);
  }
  return lines.join("\n");
}
