import JSZip from "jszip";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const OFFICE_EXTENSIONS = new Set(["docx", "pptx", "xlsx"]);

export function isOfficeFile(name: string, mime: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (OFFICE_EXTENSIONS.has(ext)) return true;
  return (
    mime === DOCX_MIME ||
    mime === PPTX_MIME ||
    mime === XLSX_MIME ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.ms-excel"
  );
}

export function officeKind(
  name: string,
  mime: string,
): "docx" | "pptx" | "xlsx" | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx" || mime === DOCX_MIME) return "docx";
  if (ext === "pptx" || mime === PPTX_MIME) return "pptx";
  if (ext === "xlsx" || mime === XLSX_MIME) return "xlsx";
  // Legacy binary Office formats need a converter we don't ship.
  if (
    mime === "application/msword" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.ms-excel" ||
    ext === "doc" ||
    ext === "ppt" ||
    ext === "xls"
  ) {
    return null;
  }
  return null;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number.parseInt(n, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) =>
      String.fromCharCode(Number.parseInt(n, 16)),
    );
}

function xmlToPlainText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<a:br\s*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/a:p>/g, "\n")
      .replace(/<\/si>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function capText(text: string, max = 120_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[… truncated]`;
}

/**
 * Extract readable plain text from OOXML Office files (docx / pptx / xlsx).
 * Returns null for unsupported / legacy binary formats.
 */
export async function extractOfficeText(
  data: ArrayBuffer | Uint8Array,
  name: string,
  mime: string,
): Promise<string | null> {
  const kind = officeKind(name, mime);
  if (!kind) return null;

  const zip = await JSZip.loadAsync(data);

  if (kind === "docx") {
    const file = zip.file("word/document.xml");
    if (!file) return null;
    return capText(xmlToPlainText(await file.async("string")));
  }

  if (kind === "pptx") {
    const slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
        const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
        return na - nb;
      });
    if (slidePaths.length === 0) return null;
    const parts: string[] = [];
    for (const path of slidePaths) {
      const file = zip.file(path);
      if (!file) continue;
      const text = xmlToPlainText(await file.async("string"));
      if (text) parts.push(`Slide ${parts.length + 1}\n${text}`);
    }
    return parts.length ? capText(parts.join("\n\n")) : null;
  }

  // xlsx — shared strings + first few sheets' inline values
  const shared: string[] = [];
  const sharedFile = zip.file("xl/sharedStrings.xml");
  if (sharedFile) {
    const xml = await sharedFile.async("string");
    const siBlocks = xml.match(/<si[\s>][\s\S]*?<\/si>/g) ?? [];
    for (const block of siBlocks) {
      shared.push(xmlToPlainText(block).replace(/\n+/g, " "));
    }
  }

  const sheetPaths = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/sheet(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/sheet(\d+)/i)?.[1] ?? 0);
      return na - nb;
    })
    .slice(0, 5);

  const sheetParts: string[] = [];
  for (const path of sheetPaths) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const rows = xml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? [];
    const lines: string[] = [];
    for (const row of rows.slice(0, 400)) {
      const cells = row.match(/<c[\s>][\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? [];
      const vals: string[] = [];
      for (const cell of cells) {
        const isShared = /\bt="s"/.test(cell);
        const v = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (v == null) {
          vals.push("");
          continue;
        }
        if (isShared) {
          const idx = Number.parseInt(v, 10);
          vals.push(Number.isFinite(idx) ? (shared[idx] ?? v) : v);
        } else {
          vals.push(decodeXmlEntities(v));
        }
      }
      if (vals.some((x) => x.trim())) lines.push(vals.join("\t"));
    }
    if (lines.length) {
      sheetParts.push(`Sheet ${sheetParts.length + 1}\n${lines.join("\n")}`);
    }
  }

  return sheetParts.length ? capText(sheetParts.join("\n\n")) : null;
}
