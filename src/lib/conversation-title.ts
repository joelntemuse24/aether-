/**
 * Conversation title helpers — aim-based labels, not first-N-chars of the prompt.
 */

const MAX_LEN = 52;

/** Strip noise then invent a short label when the model call is unavailable. */
export function fallbackConversationTitle(message: string): string {
  let text = message.trim().replace(/\s+/g, " ");
  if (!text) return "New chat";

  // Keep owner/repo; drop full github URLs.
  text = text.replace(
    /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[^\s]*)?/gi,
    "$1",
  );
  text = text.replace(/https?:\/\/[^\s]+/gi, "").replace(/\s+/g, " ").trim();

  const lower = text.toLowerCase();

  // Common intent shapes → compact titles.
  const whyMem = lower.match(
    /why do i (often )?have (.+?) (when|on|with|in) (.+)/i,
  );
  if (whyMem) {
    return clipTitle(
      `${capitalize(whyMem[2])} on ${truncateWords(whyMem[4], 4)}`,
    );
  }

  const review = lower.match(
    /^(please )?(review|audit|debug|fix|refactor|explain)\b(.+)/i,
  );
  if (review) {
    const verb = capitalize(review[2]);
    const rest = truncateWords(review[3].replace(/^[:\s-]+/, ""), 6);
    return clipTitle(rest ? `${verb}: ${rest}` : verb);
  }

  // First sentence / clause.
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  const cleaned = sentence
    .replace(/^(hey|hi|hello|yo|please|can you|could you|would you)\b[,!]?\s+/i, "")
    .replace(/^(i need you to|i want you to|help me)\b\s+/i, "")
    .trim();

  return clipTitle(cleaned || text);
}

function capitalize(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function truncateWords(s: string, maxWords: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

function clipTitle(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  if (t.length <= MAX_LEN) return t.replace(/[.!?]+$/, "") || t;
  const sliced = t.slice(0, MAX_LEN - 1);
  const at = sliced.lastIndexOf(" ");
  const base = (at > 24 ? sliced.slice(0, at) : sliced).replace(/[,:;.-]+$/, "");
  return `${base}…`;
}

export function sanitizeModelTitle(raw: string, fallback: string): string {
  let t = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  t = t.split("\n")[0]?.trim() ?? "";
  t = t.replace(/^title\s*:\s*/i, "");
  if (!t || t.length < 2) return fallback;
  return clipTitle(t);
}
