import { parseDataUrl } from "@/lib/office/file-artifact";
import { artifactDownloadPath } from "./file-result";

export { artifactDownloadPath };

export function bytesFromArtifactContent(
  content: string,
): { buffer: Buffer; mime: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const parsed = parseDataUrl(trimmed);
  if (parsed && parsed.buffer.byteLength > 0) return parsed;
  if (parsed) return null;
  return { buffer: Buffer.from(trimmed, "utf8"), mime: "application/octet-stream" };
}

export function downloadFilename(input: {
  title?: string;
  language?: string;
  mime?: string;
}): string {
  const language = input.language?.trim() || "";
  if (language.includes(".")) return language.replace(/[/\\]/g, "_");
  const title = (input.title || "file").replace(/[/\\]/g, "_").trim() || "file";
  const mime = input.mime || "";
  const ext = mime.includes("presentation")
    ? "pptx"
    : mime.includes("spreadsheet") || mime.includes("sheet")
      ? "xlsx"
      : mime.includes("wordprocessing")
        ? "docx"
        : mime.includes("pdf")
          ? "pdf"
          : "bin";
  return language ? `${title}.${language}` : `${title}.${ext}`;
}

export function fileDownloadHeaders(
  filename: string,
  mime: string,
  bytes: number,
): Record<string, string> {
  const safe = filename.replace(/[\r\n"]/g, "_");
  return {
    "Content-Type": mime || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safe}"`,
    "Content-Length": String(bytes),
    "Cache-Control": "private, max-age=0, must-revalidate",
  };
}
