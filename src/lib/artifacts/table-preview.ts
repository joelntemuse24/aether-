import { parseDataUrl } from "@/lib/office/file-artifact";

export type FilePreviewMode = "table" | "download";

export function fileExtension(filename?: string | null): string {
  return filename?.split(".").pop()?.toLowerCase() ?? "";
}

export function filePreviewMode(filename?: string | null): FilePreviewMode {
  const ext = fileExtension(filename);
  return ext === "csv" || ext === "xlsx" ? "table" : "download";
}

export function isXlsxFilename(filename?: string | null): boolean {
  return fileExtension(filename) === "xlsx";
}

export function textFromArtifactContent(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const parsed = parseDataUrl(trimmed);
  if (parsed) {
    const text = parsed.buffer.toString("utf8");
    return text || null;
  }
  return trimmed;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

export function parseCsvTable(
  csv: string,
): { columns: string[]; rows: Record<string, unknown>[] } | null {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;
  const columns = parseCsvLine(lines[0]!).map((h, i) => h.trim() || `col_${i + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });
    return row;
  });
  return { columns, rows };
}

export type XlsxTable = {
  columns: string[];
  rows: Record<string, unknown>[];
  /** True when the first sheet had more rows or columns than the preview shows. */
  truncated: boolean;
  sheetName: string;
};

/** Preview caps. Rows exclude the header row. */
export const XLSX_PREVIEW_MAX_ROWS = 200;
export const XLSX_PREVIEW_MAX_COLS = 40;

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function xmlUnescape(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === "#") {
      const code =
        ent[1] === "x" || ent[1] === "X"
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return XML_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? xmlUnescape(m[1]!) : undefined;
}

/** Concatenated `<t>` text of a shared-string item or inline string, skipping phonetic runs. */
function textRuns(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    out += m[1] ? xmlUnescape(m[1]) : "";
  }
  return out;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    out.push(m[1] ? textRuns(m[1]) : "");
  }
  return out;
}

function colIndex(ref: string): number {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cellText(
  attrs: string,
  body: string,
  shared: string[],
): string {
  const type = attr(attrs, "t");
  if (type === "inlineStr") return textRuns(body);
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (v == null) return "";
  const raw = xmlUnescape(v);
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

/** First worksheet part path, resolved through workbook.xml and its rels. */
function firstSheet(
  workbook: string | null,
  rels: string | null,
  paths: string[],
): { path: string; name: string } | null {
  const sheetTag = workbook ? /<sheet\b([^>]*?)\/?>/.exec(workbook) : null;
  const name = sheetTag ? (attr(sheetTag[1]!, "name") ?? "") : "";
  const rid = sheetTag ? attr(sheetTag[1]!, "r:id") : undefined;
  if (rid && rels) {
    const relRe = /<Relationship\b([^>]*?)\/?>/g;
    for (let m = relRe.exec(rels); m; m = relRe.exec(rels)) {
      if (attr(m[1]!, "Id") !== rid) continue;
      const target = attr(m[1]!, "Target");
      if (!target) break;
      const path = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.?\//, "")}`;
      if (paths.includes(path)) return { path, name };
      break;
    }
  }
  const fallback = paths
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => parseInt(a.replace(/\D/g, ""), 10) - parseInt(b.replace(/\D/g, ""), 10))[0];
  return fallback ? { path: fallback, name } : null;
}

function xlsxBytes(source: Buffer | Uint8Array | string): Uint8Array | string {
  if (typeof source !== "string") return source;
  const trimmed = source.trim();
  const comma = trimmed.startsWith("data:") ? trimmed.indexOf(",") : -1;
  return comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
}

/**
 * Reads the first worksheet of an .xlsx workbook into a table.
 * Accepts bytes, a base64 string, or a `data:` URL. Returns null when the file
 * is not a readable workbook or the first sheet has no cells.
 */
export async function parseXlsxTable(
  source: Buffer | Uint8Array | string,
): Promise<XlsxTable | null> {
  try {
    const { default: JSZip } = await import("jszip");
    const input = xlsxBytes(source);
    const zip =
      typeof input === "string"
        ? await JSZip.loadAsync(input.replace(/\s+/g, ""), { base64: true })
        : await JSZip.loadAsync(input);
    const read = async (path: string) => {
      const file = zip.file(path);
      return file ? await file.async("string") : null;
    };
    const paths = Object.keys(zip.files);
    const sheet = firstSheet(
      await read("xl/workbook.xml"),
      await read("xl/_rels/workbook.xml.rels"),
      paths,
    );
    if (!sheet) return null;
    const sheetXml = await read(sheet.path);
    if (!sheetXml) return null;
    const shared = parseSharedStrings(await read("xl/sharedStrings.xml"));

    // Header row plus the body cap, read in sheet order; stop once the cap is passed.
    const maxRowsRead = XLSX_PREVIEW_MAX_ROWS + 1;
    const grid: Array<Map<number, string>> = [];
    let truncated = false;
    let width = 0;
    const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    for (let rm = rowRe.exec(sheetXml); rm; rm = rowRe.exec(sheetXml)) {
      const cells = new Map<number, string>();
      const body = rm[2] ?? "";
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let col = -1;
      for (let cm = cellRe.exec(body); cm; cm = cellRe.exec(body)) {
        const ref = attr(cm[1]!, "r");
        col = ref ? colIndex(ref) : col + 1;
        if (col < 0) continue;
        const text = cellText(cm[1]!, cm[2] ?? "", shared).trim();
        if (!text) continue;
        if (col >= XLSX_PREVIEW_MAX_COLS) {
          truncated = true;
          continue;
        }
        cells.set(col, text);
        width = Math.max(width, col + 1);
      }
      if (cells.size === 0) continue;
      if (grid.length >= maxRowsRead) {
        truncated = true;
        break;
      }
      grid.push(cells);
    }
    if (grid.length === 0) return null;

    const used = new Set<string>();
    const columns = Array.from({ length: width }, (_, i) => {
      const base = grid[0]!.get(i) || `col_${i + 1}`;
      let name = base;
      for (let n = 2; used.has(name); n += 1) name = `${base} (${n})`;
      used.add(name);
      return name;
    });
    const rows = grid.slice(1).map((cells) => {
      const row: Record<string, unknown> = {};
      columns.forEach((name, i) => {
        row[name] = cells.get(i) ?? "";
      });
      return row;
    });
    return { columns, rows, truncated, sheetName: sheet.name };
  } catch {
    return null;
  }
}
