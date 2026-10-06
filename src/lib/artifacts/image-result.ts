import { artifactDownloadPath, type FilePersistState } from "./file-result";

export const GUEST_IMAGE_HINT =
  "This image is shown in this thread. Sign in to keep it in your account.";

export type ImageToolResultInput = {
  title: string;
  /** Data URL (binary bytes) or https URL. */
  content: string;
  mime?: string;
  saved: FilePersistState;
};

export type ImageToolResult = {
  ok: true;
  kind: "image";
  title: string;
  persisted: boolean;
  id?: string;
  mime?: string;
  downloadPath?: string;
  bytes?: number;
  content?: string;
  hint?: string;
};

const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,/i;

export function isImageDataUrl(value: string): boolean {
  return IMAGE_DATA_URL.test(value.trim());
}

export function mimeFromImageDataUrl(value: string): string | undefined {
  return /^data:(image\/[a-z0-9.+-]+);/i.exec(value.trim())?.[1]?.toLowerCase();
}

function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = dataUrl.slice(comma + 1).replace(/\s+/g, "");
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Shape an image artifact for the thread.
 * Persisted data URLs return a download path and omit the (large) data URL, the
 * same as fileToolResult. Guests and https URLs keep `content` for the preview.
 */
export function imageToolResult(input: ImageToolResultInput): ImageToolResult {
  const mime = input.mime || mimeFromImageDataUrl(input.content);
  const base = {
    ok: true as const,
    kind: "image" as const,
    title: input.title,
    ...(mime ? { mime } : {}),
  };
  const isData = isImageDataUrl(input.content);
  if (input.saved.persisted && input.saved.id && isData) {
    return {
      ...base,
      id: input.saved.id,
      persisted: true,
      downloadPath: artifactDownloadPath(input.saved.id),
      bytes: dataUrlByteLength(input.content),
    };
  }
  if (input.saved.persisted && input.saved.id) {
    return {
      ...base,
      id: input.saved.id,
      persisted: true,
      content: input.content,
    };
  }
  return {
    ...base,
    ...(input.saved.id ? { id: input.saved.id } : {}),
    persisted: false,
    content: input.content,
    ...(isData ? { hint: GUEST_IMAGE_HINT } : {}),
  };
}

export type ImageContentClass =
  | { type: "data-url"; dataUrl: string }
  | { type: "base64"; dataUrl: string }
  | { type: "url"; url: string }
  | { type: "path"; path: string }
  | { type: "unknown" };

const BASE64_BODY = /^[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_PATH_EXT = /\.(png|jpe?g|webp|gif)$/i;

function sniffBase64Mime(b64: string): string | undefined {
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  if (b64.startsWith("PHN2Zy") || b64.startsWith("PD94bWw")) return "image/svg+xml";
  return undefined;
}

/**
 * Decide what create_artifact received for an image: a data URL, raw base64,
 * an https URL, or a sandbox path the model forgot to publish.
 * `mimeHint` comes from a language/filename such as "chart.png".
 */
export function classifyImageContent(
  content: string,
  mimeHint?: string,
): ImageContentClass {
  const trimmed = content.trim();
  if (!trimmed) return { type: "unknown" };
  if (isImageDataUrl(trimmed)) return { type: "data-url", dataUrl: trimmed };
  if (/^data:/i.test(trimmed)) return { type: "unknown" };
  if (/^https:\/\/\S+$/i.test(trimmed)) return { type: "url", url: trimmed };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return { type: "unknown" };

  if (/^<(svg\b|\?xml)/i.test(trimmed) && /<svg\b/i.test(trimmed)) {
    const b64 = Buffer.from(trimmed, "utf8").toString("base64");
    return { type: "base64", dataUrl: `data:image/svg+xml;base64,${b64}` };
  }

  const single = !/[\r\n]/.test(trimmed) && trimmed.length <= 512;
  // "/9j/" opens a base64 JPEG, so it is not an absolute path.
  const absolutePath = trimmed.startsWith("/") && !trimmed.startsWith("/9j/");
  if (single && (absolutePath || IMAGE_PATH_EXT.test(trimmed))) {
    return { type: "path", path: trimmed };
  }

  const compact = trimmed.replace(/\s+/g, "");
  if (compact.length >= 100 && !trimmed.includes(" ") && BASE64_BODY.test(compact)) {
    const mime =
      sniffBase64Mime(compact) ||
      (mimeHint && mimeHint.startsWith("image/") ? mimeHint : undefined) ||
      "image/png";
    return { type: "base64", dataUrl: `data:${mime};base64,${compact}` };
  }
  return { type: "unknown" };
}
