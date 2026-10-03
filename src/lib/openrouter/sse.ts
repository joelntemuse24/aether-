/** Pull assistant text deltas out of one OpenRouter SSE chunk. */
export function textFromOpenRouterSse(chunk: string): string {
  let text = "";
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: unknown } }[];
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string") text += content;
    } catch {
      continue;
    }
  }
  return text;
}
