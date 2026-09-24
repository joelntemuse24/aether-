import type { IncomingAttachment } from "@/lib/chat-turn";

export type TrueForgeUserPart =
  | { type: "text"; text: string }
  | { type: "file"; data: string; name: string };

/** String when the turn is text-only. Files ride along as data-URI parts. */
export function buildTrueForgeUserContent(
  text: string,
  attachments: IncomingAttachment[] = [],
): string | TrueForgeUserPart[] {
  const files = attachments.filter((file) => file.dataUrl && file.name);
  if (files.length === 0) return text;
  const parts: TrueForgeUserPart[] = [];
  if (text) parts.push({ type: "text", text });
  for (const file of files) {
    parts.push({ type: "file", data: file.dataUrl, name: file.name });
  }
  return parts.length > 0 ? parts : text;
}
