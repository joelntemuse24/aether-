export const CANONICAL_ARTIFACT_KINDS = [
  "markdown",
  "code",
  "html",
  "react",
  "svg",
  "csv",
  "image",
  "pptx",
  "xlsx",
  "docx",
  "pdf",
] as const;

/** Back-compat aliases from Milestone A/B persist + older create_artifact calls. */
export const ARTIFACT_KINDS = [
  ...CANONICAL_ARTIFACT_KINDS,
  "document",
  "data",
  "file",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type CanonicalArtifactKind = (typeof CANONICAL_ARTIFACT_KINDS)[number];

export type ArtifactKindHint = {
  language?: string;
  mime?: string;
  filename?: string;
};

const PREVIEWABLE_CODE_LANGS = new Set([
  "html",
  "htm",
  "svg",
  "jsx",
  "tsx",
  "react",
  "javascript",
  "js",
]);

const EXT_BY_LANG: Record<string, string> = {
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
  react: "jsx",
  python: "py",
  py: "py",
  html: "html",
  htm: "html",
  css: "css",
  json: "json",
  markdown: "md",
  md: "md",
  svg: "svg",
  csv: "csv",
};

const FILE_KIND_BY_EXT: Record<string, CanonicalArtifactKind> = {
  pptx: "pptx",
  xlsx: "xlsx",
  docx: "docx",
  pdf: "pdf",
};

export function normalizeArtifactKind(
  kind: string | undefined,
  hint: ArtifactKindHint = {},
): ArtifactKind {
  const raw = (kind || "code").toLowerCase().trim();
  if (raw === "document") return "markdown";
  if (raw === "data") return "csv";
  if (raw === "file") {
    const fromHint = fileKindFromHint(hint);
    return fromHint ?? "file";
  }
  if ((ARTIFACT_KINDS as readonly string[]).includes(raw)) {
    return raw as ArtifactKind;
  }
  return "code";
}

function fileKindFromHint(hint: ArtifactKindHint): CanonicalArtifactKind | null {
  const blob = `${hint.filename || ""} ${hint.language || ""} ${hint.mime || ""}`.toLowerCase();
  if (blob.includes("pptx") || blob.includes("presentationml")) return "pptx";
  if (blob.includes("xlsx") || blob.includes("spreadsheetml")) return "xlsx";
  if (blob.includes("docx") || blob.includes("wordprocessingml")) return "docx";
  if (blob.includes("pdf") || hint.mime === "application/pdf") return "pdf";
  const ext = (
    hint.filename ||
    hint.language ||
    ""
  )
    .split(".")
    .pop()
    ?.toLowerCase();
  return ext ? FILE_KIND_BY_EXT[ext] ?? null : null;
}

export function isLivePreviewKind(kind: string, language?: string): boolean {
  const k = normalizeArtifactKind(kind);
  if (k === "html" || k === "react" || k === "svg") return true;
  if (k === "code") return PREVIEWABLE_CODE_LANGS.has((language || "").toLowerCase());
  return false;
}

export function isTextArtifactKind(kind: string): boolean {
  const k = normalizeArtifactKind(kind);
  return (
    k === "markdown" ||
    k === "document" ||
    k === "code" ||
    k === "html" ||
    k === "react" ||
    k === "svg" ||
    k === "csv" ||
    k === "data"
  );
}

export function isFileArtifactKind(kind: string): boolean {
  const k = normalizeArtifactKind(kind);
  return k === "file" || k === "pptx" || k === "xlsx" || k === "docx" || k === "pdf";
}

export type ArtifactPreviewMode = "live" | "document" | "table" | "image" | "file" | "code";

export function previewMode(kind: string, language?: string): ArtifactPreviewMode {
  const k = normalizeArtifactKind(kind);
  if (isFileArtifactKind(k)) return "file";
  if (k === "image") return "image";
  if (k === "markdown" || k === "document") return "document";
  if (k === "csv" || k === "data") return "table";
  if (isLivePreviewKind(k, language)) return "live";
  return "code";
}

export function downloadExtension(kind: string, language?: string): string {
  const k = normalizeArtifactKind(kind, { language });
  if (k === "html") return "html";
  if (k === "react") return "jsx";
  if (k === "markdown" || k === "document") return "md";
  if (k === "csv" || k === "data") return "csv";
  if (k === "svg") return "svg";
  if (k === "pptx" || k === "xlsx" || k === "docx" || k === "pdf") return k;
  const lang = (language || "").toLowerCase();
  return EXT_BY_LANG[lang] || (language?.includes(".") ? language.split(".").pop()! : "txt");
}

export function downloadMime(kind: string, language?: string): string {
  const k = normalizeArtifactKind(kind, { language });
  if (k === "html") return "text/html";
  if (k === "react") return "text/javascript";
  if (k === "markdown" || k === "document") return "text/markdown";
  if (k === "csv" || k === "data") return "text/csv";
  if (k === "svg") return "image/svg+xml";
  if (language === "json") return "application/json";
  return "text/plain";
}

export function parseCsv(content: string): {
  rows: Record<string, unknown>[];
  columns: string[];
} | null {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const columns = splitCsvLine(lines[0]!);
  if (columns.length === 0 || columns.every((c) => !c.trim())) return null;
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? "";
    });
    return row;
  });
  return { rows, columns };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}
