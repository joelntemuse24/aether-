import { slugFilename } from "./xml";
import { bufferToDataUrl } from "./file-artifact";

export const PDF_MIME = "application/pdf";

export type PdfInput = {
  title: string;
  paragraphs: string[];
};

const MAX_PARAS = 80;
const MAX_CHARS = 2000;
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const TITLE_SIZE = 18;
const BODY_SIZE = 12;
const TITLE_LEADING = 24;
const BODY_LEADING = 16;

function clip(value: string, max = MAX_CHARS): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function toWinAnsi(text: string): string {
  return [...text]
    .map((ch) => (ch.charCodeAt(0) <= 255 ? ch : "?"))
    .join("");
}

function pdfEscape(text: string): string {
  return toWinAnsi(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text: string, fontSize: number): string[] {
  const maxWidth = PAGE_W - MARGIN * 2;
  const charW = fontSize * 0.5;
  const maxChars = Math.max(8, Math.floor(maxWidth / charW));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (word.length <= maxChars) {
      current = word;
      continue;
    }
    for (let i = 0; i < word.length; i += maxChars) {
      const chunk = word.slice(i, i + maxChars);
      if (chunk.length === maxChars) lines.push(chunk);
      else current = chunk;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

type PdfLine = { text: string; size: number; leading: number };

function layoutLines(title: string, paragraphs: string[]): PdfLine[] {
  const lines: PdfLine[] = wrapLine(title, TITLE_SIZE).map((text) => ({
    text,
    size: TITLE_SIZE,
    leading: TITLE_LEADING,
  }));
  for (const para of paragraphs) {
    lines.push({ text: "", size: BODY_SIZE, leading: BODY_LEADING });
    for (const text of wrapLine(para, BODY_SIZE)) {
      lines.push({ text, size: BODY_SIZE, leading: BODY_LEADING });
    }
  }
  return lines;
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const usable = PAGE_H - MARGIN * 2;
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let used = 0;
  for (const line of lines) {
    if (current.length > 0 && used + line.leading > usable) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += line.leading;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[{ text: "", size: BODY_SIZE, leading: BODY_LEADING }]];
}

function pageStream(lines: PdfLine[]): string {
  const startY = PAGE_H - MARGIN;
  const ops: string[] = ["BT", `/F1 ${lines[0]?.size ?? BODY_SIZE} Tf`];
  let lastSize = lines[0]?.size ?? BODY_SIZE;
  let first = true;
  let y = startY;
  for (const line of lines) {
    if (line.size !== lastSize) {
      ops.push(`/F1 ${line.size} Tf`);
      lastSize = line.size;
    }
    if (first) {
      ops.push(`1 0 0 1 ${MARGIN} ${y} Tm`);
      first = false;
    } else {
      ops.push(`0 -${line.leading} Td`);
    }
    y -= line.leading;
    ops.push(`(${pdfEscape(line.text)}) Tj`);
  }
  ops.push("ET");
  return ops.join("\n");
}

function xrefEntry(offset: number, generation: number, free: boolean): string {
  const off = String(offset).padStart(10, "0");
  const gen = String(generation).padStart(5, "0");
  return `${off} ${gen} ${free ? "f" : "n"} \n`;
}

function assemblePdf(objectBodies: string[]): Buffer {
  const header = "%PDF-1.4\n";
  let body = header;
  const offsets = [0];
  for (let i = 0; i < objectBodies.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objectBodies[i]}\nendobj\n`;
  }
  const xrefPos = body.length;
  let xref = `xref\n0 ${objectBodies.length + 1}\n`;
  xref += xrefEntry(0, 65535, true);
  for (let i = 1; i <= objectBodies.length; i++) {
    xref += xrefEntry(offsets[i]!, 0, false);
  }
  const trailer = `trailer\n<< /Size ${objectBodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

export function normalizePdfInput(input: PdfInput): {
  title: string;
  paragraphs: string[];
} {
  const title = clip(input.title, 280) || "Document";
  const paragraphs = (input.paragraphs ?? [])
    .map((p) => clip(p))
    .filter(Boolean)
    .slice(0, MAX_PARAS);
  return { title, paragraphs };
}

export async function buildDocumentPdf(input: PdfInput): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
  pageCount: number;
  dataUrl: string;
}> {
  const { title, paragraphs } = normalizePdfInput(input);
  const pages = paginate(layoutLines(title, paragraphs));
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const fontObj = 3;
  objects.push(""); // pages placeholder
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  for (const page of pages) {
    const stream = pageStream(page);
    const contentId = objects.length + 2;
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`;
  const buffer = assemblePdf(objects);
  return {
    buffer,
    filename: slugFilename(title, "pdf"),
    mime: PDF_MIME,
    pageCount: pageIds.length,
    dataUrl: bufferToDataUrl(buffer, PDF_MIME),
  };
}
