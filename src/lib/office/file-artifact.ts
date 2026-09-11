import { PPTX_MIME, XLSX_MIME, DOCX_MIME } from "@/lib/office-text";

const MIME_BY_EXT: Record<string, string> = {
  pptx: PPTX_MIME,
  xlsx: XLSX_MIME,
  docx: DOCX_MIME,
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
};

export function mimeForFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export function bufferToDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function isFileDataUrl(value: string): boolean {
  return /^data:[^;]+;base64,/i.test(value.trim());
}

export function parseDataUrl(value: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) return null;
  return {
    mime: match[1]!,
    buffer: Buffer.from(match[2]!.replace(/\s+/g, ""), "base64"),
  };
}
