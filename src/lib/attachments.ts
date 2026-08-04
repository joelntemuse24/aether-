import { extractOfficeText, isOfficeFile } from "@/lib/office-text";

export type AttachmentKind = "image" | "text" | "file";

export type PendingAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** Prefer the off-React payload store; rarely kept inline for tiny payloads. */
  dataUrl?: string;
  /** extracted text for text files */
  text?: string;
  /**
   * True when binary payload lives in the off-React payload store
   * (`attachment-payloads`) rather than `dataUrl`.
   */
  hasPayload?: boolean;
};

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "html",
  "css",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "sh",
  "sql",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (matches most AI provider limits)
/** Max files pending on a message (local + Drive combined). */
export const MAX_ATTACHMENTS = 6;
/**
 * Max raw bytes we'll base64-embed for a non-image file (e.g. PDF).
 * Keep low: JSON + base64 (~4/3) must fit serverless body limits cleanly.
 */
export const MAX_EMBEDDED_FILE_BYTES = 1.5 * 1024 * 1024;
/** Max raw bytes we'll embed for a single image (vision models). */
export const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * Soft budget for total embedded binary payloads awaiting send.
 * Keeps JSON.stringify of the chat request from freezing the tab / 413s.
 */
export const MAX_TOTAL_EMBEDDED_BYTES = 4 * 1024 * 1024;

export function isTextFile(name: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(name: string, mime: string): boolean {
  if (mime.startsWith("image/")) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

export function isPdfFile(name: string, mime: string): boolean {
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

function resolveImageMime(name: string, mime: string): string {
  if (mime.startsWith("image/")) return mime;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_BY_EXT[ext] ?? "image/png";
}

/** True when the model will receive file/image bytes (not just a name stub). */
export function attachmentIsModelReadable(a: PendingAttachment): boolean {
  if (a.kind === "text" && a.text) return true;
  if (a.kind === "image") return !!(a.dataUrl || a.hasPayload);
  if (a.kind === "file") return !!(a.dataUrl || a.hasPayload);
  return false;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function mbLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${mb.toFixed(0)} MB`;
}

export async function processFiles(
  fileList: FileList | File[],
  existingCount: number,
): Promise<{ attachments: PendingAttachment[]; errors: string[] }> {
  const files = Array.from(fileList);
  const errors: string[] = [];
  const attachments: PendingAttachment[] = [];

  const remainingSlots = MAX_ATTACHMENTS - existingCount;
  if (remainingSlots <= 0) {
    return { attachments: [], errors: [`Maximum of ${MAX_ATTACHMENTS} files allowed.`] };
  }

  for (const file of files.slice(0, remainingSlots)) {
    if (file.size > MAX_FILE_SIZE) {
      errors.push(`${file.name} is larger than 25 MB and was skipped.`);
      continue;
    }

    const id = crypto.randomUUID();
    const mime =
      file.type ||
      (isPdfFile(file.name, file.type)
        ? "application/pdf"
        : isImageFile(file.name, file.type)
          ? resolveImageMime(file.name, file.type)
          : "application/octet-stream");
    const base = {
      id,
      name: file.name,
      mime,
      size: file.size,
    };

    try {
      if (isImageFile(file.name, file.type)) {
        if (file.size > MAX_EMBEDDED_IMAGE_BYTES) {
          attachments.push({ ...base, kind: "image" });
          errors.push(
            `"${file.name}" is larger than ${mbLabel(MAX_EMBEDDED_IMAGE_BYTES)}, so it was attached by name only (model cannot see the image).`,
          );
        } else {
          const dataUrl = await readAsDataURL(file);
          attachments.push({ ...base, kind: "image", dataUrl });
        }
      } else if (isTextFile(file.name, file.type)) {
        const text = await file.text();
        // Cap very large text files
        const capped = text.length > 120_000 ? text.slice(0, 120_000) + "\n\n[… truncated]" : text;
        attachments.push({ ...base, kind: "text", text: capped });
      } else if (isOfficeFile(file.name, file.type || mime)) {
        try {
          const buf = await file.arrayBuffer();
          const text = await extractOfficeText(buf, file.name, file.type || mime);
          if (text) {
            attachments.push({
              ...base,
              kind: "text",
              mime: "text/plain",
              text,
              size: text.length,
            });
          } else {
            attachments.push({ ...base, kind: "file" });
            errors.push(
              `"${file.name}" looks like a legacy Office file — convert to .docx/.pptx/.xlsx or paste the text.`,
            );
          }
        } catch {
          attachments.push({ ...base, kind: "file" });
          errors.push(`Could not read text from "${file.name}".`);
        }
      } else if (isPdfFile(file.name, file.type)) {
        // Embed local PDFs the same way Drive does (base64 data URL), within budget.
        if (file.size > MAX_EMBEDDED_FILE_BYTES) {
          attachments.push({ ...base, kind: "file" });
          errors.push(
            `"${file.name}" is larger than ${mbLabel(MAX_EMBEDDED_FILE_BYTES)}, so it was attached by name only (model cannot read the PDF bytes).`,
          );
        } else {
          const dataUrl = await readAsDataURL(file);
          attachments.push({ ...base, kind: "file", dataUrl });
        }
      } else {
        attachments.push({ ...base, kind: "file" });
        errors.push(
          `"${file.name}" was attached by name only (model cannot read this file type).`,
        );
      }
    } catch {
      errors.push(`Could not read ${file.name}.`);
    }
  }

  if (files.length > remainingSlots) {
    const skipped = files.length - remainingSlots;
    if (existingCount === 0) {
      errors.push(
        `You can attach up to ${MAX_ATTACHMENTS} files. ${skipped} skipped.`,
      );
    } else {
      errors.push(
        `Skipped ${skipped} file(s) — only ${remainingSlots} attachment slot(s) left.`,
      );
    }
  }

  return { attachments, errors };
}

/** Build a text block that gets prepended to the user message for non-image files. */
export function buildTextAttachmentPrefix(attachments: PendingAttachment[]): string {
  const textOnes = attachments.filter((a) => a.kind === "text" && a.text);
  const fileOnes = attachments.filter((a) => a.kind === "file");

  if (textOnes.length === 0 && fileOnes.length === 0) return "";

  const parts: string[] = [];

  for (const a of textOnes) {
    parts.push(`--- Attached file: ${a.name} ---\n${a.text}\n--- End of ${a.name} ---`);
  }

  for (const a of fileOnes) {
    if (a.hasPayload || a.dataUrl) {
      parts.push(`[Attached file: ${a.name} (${a.mime}) — bytes included]`);
    } else {
      parts.push(
        `[Attached file: ${a.name} (${a.mime}) — name only; content was not included]`,
      );
    }
  }

  return parts.join("\n\n") + "\n\n";
}
