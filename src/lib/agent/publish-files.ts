/**
 * Download cards for files a sandbox command created.
 * Filenames stay relative. Host paths and sandbox: links are dropped.
 */

export const PUBLISHED_EXTENSIONS = new Set([
  "pptx",
  "xlsx",
  "png",
  "csv",
  "pdf",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
]);

export const MAX_PUBLISHED_FILES = 4;
export const MAX_PUBLISHED_BYTES = 1_500_000;

export type SandboxFilePayload = {
  filename: string;
  mime: string;
  bytes: number;
  dataUrl: string;
};

export type SandboxFileCard = {
  filename: string;
  title: string;
  mime: string;
  bytes: number;
  persisted: boolean;
  downloadPath?: string;
  content?: string;
  hint?: string;
};

export function mimeForPublishedExtension(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "csv":
      return "text/csv";
    case "pdf":
      return "application/pdf";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "application/octet-stream";
  }
}

export function isSafePublishedFilename(filename: string): boolean {
  const name = filename.trim();
  if (!name || name.length > 180) return false;
  if (name.includes("\0") || name.includes("\\") || name.includes("sandbox:")) return false;
  if (name.startsWith("/") || name.includes("/workspace")) return false;
  const parts = name.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return false;
  const ext = parts[parts.length - 1]?.split(".").pop()?.toLowerCase() ?? "";
  return PUBLISHED_EXTENSIONS.has(ext);
}

/** Hide sandbox and host paths. The model still sees the command's text. */
export function redactSandboxText(value: string): string {
  return value
    .replace(/sandbox:\S*/gi, "")
    .replace(/\/workspace\/?/g, "")
    .replace(/\/(?:opt|home|root)\/\S*/g, "");
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function sanitizePublishedFile(value: unknown): SandboxFileCard | null {
  const row = record(value);
  if (!row) return null;
  const filename = typeof row.filename === "string" ? row.filename.trim() : "";
  if (!isSafePublishedFilename(filename)) return null;
  const content = typeof row.content === "string" && row.content.startsWith("data:") ? row.content : undefined;
  const downloadPath =
    typeof row.downloadPath === "string" && row.downloadPath.startsWith("/api/artifacts/")
      ? row.downloadPath
      : undefined;
  if (!content && !downloadPath) return null;
  const title =
    typeof row.title === "string" && row.title.trim() && !row.title.includes("/") && !row.title.includes("sandbox:")
      ? row.title.trim()
      : filename.split("/").pop() || filename;
  const bytes = typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : 0;
  const mime = typeof row.mime === "string" && row.mime.trim() ? row.mime.trim() : "application/octet-stream";
  return {
    filename,
    title,
    mime,
    bytes,
    persisted: row.persisted === true && !!downloadPath,
    ...(downloadPath ? { downloadPath } : {}),
    ...(content && !downloadPath ? { content } : {}),
    ...(typeof row.hint === "string" && row.hint.trim() ? { hint: row.hint.trim() } : {}),
  };
}

/** File cards inside a native tool result. Ignores host paths and sandbox: links. */
export function sandboxFileCards(result: unknown): SandboxFileCard[] {
  const root = record(result);
  if (!root) return [];
  const data = record(root.data) ?? root;
  const files = data.files;
  if (!Array.isArray(files)) return [];
  const cards: SandboxFileCard[] = [];
  for (const item of files) {
    const card = sanitizePublishedFile(item);
    if (card) cards.push(card);
  }
  return cards;
}
