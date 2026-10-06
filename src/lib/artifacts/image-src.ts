import { artifactDownloadPath } from "./file-result";

/**
 * Client-safe href resolution for image and file artifacts.
 * Pure string helpers: no Buffer, no server imports.
 */

export function isRemoteImageUrl(content: string | undefined): boolean {
  return !!content && /^https?:\/\/\S+$/i.test(content.trim());
}

/** Image bytes the browser can paint directly (a data URL or remote URL). */
export function isPaintableImageContent(content: string | undefined): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (trimmed.includes("[truncated]")) return false;
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed) || isRemoteImageUrl(trimmed);
}

/**
 * Where the panel loads an artifact's bytes from: the download path, then the
 * cloud download route for persisted rows, then inline content. A remote image
 * URL stored as content is its own source (the download route serves bytes only).
 */
export function artifactHref(input: {
  id?: string;
  persisted?: boolean;
  downloadPath?: string;
  content?: string;
}): string | null {
  if (isRemoteImageUrl(input.content)) return input.content!.trim();
  return (
    input.downloadPath ||
    (input.persisted && input.id ? artifactDownloadPath(input.id) : null) ||
    input.content ||
    null
  );
}

/** File extension for a downloaded image, from its mime or data URL. */
export function imageFileExtension(mime?: string, content?: string): string {
  const fromData = /^data:image\/([a-z0-9.+-]+);/i.exec(content?.trim() ?? "")?.[1];
  const sub = (mime?.startsWith("image/") ? mime.slice(6) : fromData || "png").toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub.startsWith("svg")) return "svg";
  return /^[a-z0-9]+$/.test(sub) ? sub : "png";
}
