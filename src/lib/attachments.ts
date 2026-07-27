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

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (matches most AI provider limits)
/** Max files pending on a message (local + Drive combined). */
export const MAX_ATTACHMENTS = 6;
/**
 * Max raw bytes we'll base64-embed for a non-image file (e.g. Drive PDF).
 * Larger files still attach as metadata-only so the UI stays responsive.
 */
export const MAX_EMBEDDED_FILE_BYTES = 4 * 1024 * 1024;
/** Max raw bytes we'll embed for a single image (vision models). */
export const MAX_EMBEDDED_IMAGE_BYTES = 4 * 1024 * 1024;
/**
 * Soft budget for total embedded binary payloads awaiting send.
 * Keeps JSON.stringify of the chat request from freezing the tab.
 */
export const MAX_TOTAL_EMBEDDED_BYTES = 12 * 1024 * 1024;

export function isTextFile(name: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isPdfFile(name: string, mime: string): boolean {
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
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
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
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
    const base = {
      id,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
    };

    try {
      if (isImageFile(file.type)) {
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
      } else if (isPdfFile(file.name, file.type)) {
        // Local PDFs are metadata-only (no client-side PDF parse / embed).
        attachments.push({ ...base, kind: "file" });
        errors.push(
          `"${file.name}" was attached by name only — local PDFs aren't sent to the model. Use Drive for PDFs under ${mbLabel(MAX_EMBEDDED_FILE_BYTES)}, or paste the text.`,
        );
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
    errors.push(`Only ${remainingSlots} more file(s) could be added.`);
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
