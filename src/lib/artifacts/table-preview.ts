import { parseDataUrl } from "@/lib/office/file-artifact";

export type FilePreviewMode = "table" | "download";

export function filePreviewMode(filename?: string | null): FilePreviewMode {
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  return ext === "csv" ? "table" : "download";
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
