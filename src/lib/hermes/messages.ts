import type { UIMessage } from "ai";

export type OpenAIChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | OpenAIChatContentPart[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function textFromParts(parts: UIMessage["parts"] | undefined): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.type === "text" && typeof part.text === "string") {
      chunks.push(part.text);
    }
  }
  return chunks.join("");
}

function imageUrlsFromParts(parts: UIMessage["parts"] | undefined): string[] {
  if (!Array.isArray(parts)) return [];
  const urls: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    // AI SDK file parts: { type: "file", url, mediaType }
    if (part.type === "file" && typeof part.url === "string") {
      const media = typeof part.mediaType === "string" ? part.mediaType : "";
      if (media.startsWith("image/") || part.url.startsWith("data:image/")) {
        urls.push(part.url);
      }
    }
  }
  return urls;
}

/**
 * Convert Aether UIMessages (+ optional system block) into OpenAI chat messages
 * for Hermes `/v1/chat/completions`. Tool UI parts are omitted — Hermes already
 * executed tools server-side; assistant text is the durable transcript.
 */
export function toOpenAIChatMessages(
  messages: UIMessage[],
  system?: string,
): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  if (system?.trim()) {
    out.push({ role: "system", content: system.trim() });
  }

  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "system") {
      continue;
    }
    const text = textFromParts(msg.parts);
    const images =
      msg.role === "user" ? imageUrlsFromParts(msg.parts) : ([] as string[]);

    if (images.length > 0) {
      const content: OpenAIChatContentPart[] = [];
      if (text) content.push({ type: "text", text });
      for (const url of images) {
        content.push({ type: "image_url", image_url: { url, detail: "auto" } });
      }
      if (content.length === 0) continue;
      out.push({ role: msg.role === "system" ? "system" : msg.role, content });
      continue;
    }

    if (!text.trim() && msg.role !== "assistant") continue;
    out.push({
      role: msg.role === "system" ? "system" : msg.role,
      content: text,
    });
  }

  return out;
}
