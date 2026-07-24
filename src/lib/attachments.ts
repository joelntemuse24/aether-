export type AttachmentKind = "image" | "text" | "file";

export type PendingAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  /** base64 data URL for images */
  dataUrl?: string;
  /** extracted text for text files */
  text?: string;
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

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const MAX_ATTACHMENTS = 6;

export function isTextFile(name: string, mime: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(mime: string): boolean {
  return mime.startsWith("image/");
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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
      errors.push(`${file.name} is larger than 8 MB and was skipped.`);
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
        const dataUrl = await readAsDataURL(file);
        attachments.push({ ...base, kind: "image", dataUrl });
      } else if (isTextFile(file.name, file.type)) {
        const text = await file.text();
        // Cap very large text files
        const capped = text.length > 120_000 ? text.slice(0, 120_000) + "\n\n[… truncated]" : text;
        attachments.push({ ...base, kind: "text", text: capped });
      } else {
        // PDF and other binaries – keep as generic file for now
        attachments.push({ ...base, kind: "file" });
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
    parts.push(`[Attached file: ${a.name} (${a.mime})]`);
  }

  return parts.join("\n\n") + "\n\n";
}
