/**
 * Composer @-mentions for connected apps.
 * Tokens stay in the user text; the model is forced onto that tool family.
 */

export const APP_MENTION_IDS = ["drive", "github", "gmail"] as const;
export type AppMentionId = (typeof APP_MENTION_IDS)[number];

export type AppMentionOption = {
  id: AppMentionId;
  token: string;
  /** Composer chip / list label — no extra vendor branding. */
  label: string;
  /** Tool-family prefix the model must use. */
  family: string;
};

export const APP_MENTION_OPTIONS: readonly AppMentionOption[] = [
  { id: "drive", token: "Drive", label: "Drive", family: "drive_*" },
  { id: "github", token: "GitHub", label: "GitHub", family: "github_*" },
  { id: "gmail", token: "Gmail", label: "Gmail", family: "gmail_*" },
];

const TOKEN_TO_ID: Record<string, AppMentionId> = {
  drive: "drive",
  github: "github",
  gmail: "gmail",
};

/** Mentions like @Drive, @GitHub, @Gmail (case-insensitive). */
const MENTION_RE = /(?:^|[\s([{])@([A-Za-z]{2,16})\b/g;

export function parseAppMentions(text: string): AppMentionId[] {
  if (!text) return [];
  const found = new Set<AppMentionId>();
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text))) {
    const id = TOKEN_TO_ID[match[1]!.toLowerCase()];
    if (id) found.add(id);
  }
  return APP_MENTION_IDS.filter((id) => found.has(id));
}

/** Incomplete @token at the caret / end of the current word — for autocomplete. */
export function mentionQueryAtCaret(
  text: string,
  caret = text.length,
): { query: string; start: number; end: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s([{])@([A-Za-z]{0,16})$/.exec(before);
  if (!match) return null;
  const at = before.lastIndexOf("@");
  return { query: match[1] ?? "", start: at, end: caret };
}

export function filterMentionOptions(query: string): AppMentionOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...APP_MENTION_OPTIONS];
  return APP_MENTION_OPTIONS.filter(
    (opt) =>
      opt.token.toLowerCase().startsWith(q) ||
      opt.label.toLowerCase().startsWith(q) ||
      opt.id.startsWith(q),
  );
}

export function insertAppMention(
  text: string,
  option: AppMentionOption,
  caret = text.length,
): { text: string; caret: number } {
  const at = mentionQueryAtCaret(text, caret);
  const token = `@${option.token} `;
  if (!at) {
    const next = `${text}${text && !/\s$/.test(text) ? " " : ""}${token}`;
    return { text: next, caret: next.length };
  }
  const next = `${text.slice(0, at.start)}${token}${text.slice(at.end)}`;
  return { text: next, caret: at.start + token.length };
}

export function connectorMentionAddendum(
  mentions: readonly AppMentionId[],
  caps: { hasDrive?: boolean; hasGitHub?: boolean; hasGmail?: boolean },
): string {
  if (mentions.length === 0) return "";
  const lines = [
    "## Connected-app mentions (this turn)",
    "The user @-mentioned a connected app. You MUST use that tool family. Do not substitute web_search, fetch_url, or invented contents.",
  ];
  for (const id of mentions) {
    const opt = APP_MENTION_OPTIONS.find((o) => o.id === id)!;
    const connected =
      id === "drive"
        ? !!caps.hasDrive
        : id === "github"
          ? !!caps.hasGitHub
          : !!caps.hasGmail;
    if (!connected) {
      lines.push(
        `- @${opt.token} is not connected. Say so and offer Preferences — do not pretend ${opt.family} works.`,
      );
      continue;
    }
    if (id === "drive") {
      lines.push(
        `- @Drive: use drive_search / drive_read / drive_upload (or drive_write). Saving a generated file to Drive always waits on a confirm card.`,
      );
    } else if (id === "github") {
      lines.push(
        `- @GitHub: use github_* tools for repositories. Do not fetch github.com with browse_page or fetch_url.`,
      );
    } else {
      lines.push(
        `- @Gmail: use gmail_search / gmail_read / gmail_create_draft. Default to a draft. gmail_send only after a confirm card — never silent-send, including in Auto.`,
      );
    }
  }
  return lines.join("\n");
}
