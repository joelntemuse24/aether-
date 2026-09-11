export const PROJECT_KNOWLEDGE_EXTS = ["pdf", "docx", "md", "txt", "csv"] as const;
export const PROJECT_KNOWLEDGE_TOKEN_CAP_CHARS = 16_000;
export const DEFAULT_CHUNK_SIZE = 800;
export const DEFAULT_CHUNK_OVERLAP = 80;
export const MAX_KNOWLEDGE_FILE_BYTES = 2_000_000;

export type KnowledgeChunk = {
  index: number;
  text: string;
};

export type KnowledgeSearchHit = {
  fileId: string;
  filename: string;
  text: string;
  score: number;
};

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "this",
  "that",
]);

export function isAllowedKnowledgeFile(filename: string, mime?: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if ((PROJECT_KNOWLEDGE_EXTS as readonly string[]).includes(ext)) return true;
  const m = (mime || "").toLowerCase();
  return (
    m === "application/pdf" ||
    m === "text/plain" ||
    m === "text/markdown" ||
    m === "text/csv" ||
    m.includes("wordprocessingml")
  );
}

export function chunkText(
  text: string,
  size = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
): KnowledgeChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ index: 0, text: clean }];
  const chunks: KnowledgeChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push({ index, text: clean.slice(start, end).trim() });
    index += 1;
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks.filter((c) => c.text.length > 0);
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function scoreChunk(query: string, text: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!hay.includes(term)) continue;
    const hits = hay.split(term).length - 1;
    score += hits * (term.length > 4 ? 2 : 1);
  }
  return score;
}

export function searchKnowledgeChunks(
  chunks: Array<{ fileId: string; filename: string; text: string }>,
  query: string,
  limit = 6,
): KnowledgeSearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(q, `${chunk.filename} ${chunk.text}`),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function projectKnowledgePromptMode(
  files: Array<{ filename: string; text: string }>,
  cap = PROJECT_KNOWLEDGE_TOKEN_CAP_CHARS,
): "inline" | "rag" {
  const total = files.reduce((sum, f) => sum + f.text.length, 0);
  return total > cap ? "rag" : "inline";
}

export function formatProjectKnowledgeBlock(input: {
  files: Array<{ filename: string; text: string }>;
  mode: "inline" | "rag";
}): string {
  if (input.files.length === 0) return "";
  if (input.mode === "rag") {
    const names = input.files.map((f) => f.filename).join(", ");
    return [
      `## Project knowledge (${input.files.length} files)`,
      `Files: ${names}`,
      "This folder is over the in-prompt size cap. Do not assume you have the full text.",
      "Retrieve relevant passages with project_knowledge_search({ query, projectId }).",
    ].join("\n");
  }
  const bodies = input.files.map((f) => {
    const body = f.text.length > 4000 ? `${f.text.slice(0, 4000)}\n[… truncated]` : f.text;
    return `### ${f.filename}\n${body}`;
  });
  return [`## Project knowledge (${input.files.length} files)`, ...bodies].join("\n\n");
}

export function extractPlainKnowledgeText(
  data: Buffer | Uint8Array,
  filename: string,
  mime = "",
): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "txt" || ext === "csv" || mime.startsWith("text/")) {
    return Buffer.from(data).toString("utf8").replace(/\u0000/g, "").trim();
  }
  return Buffer.from(data).toString("utf8").replace(/\u0000/g, "").trim();
}

export async function extractKnowledgeText(
  data: ArrayBuffer | Uint8Array,
  filename: string,
  mime = "",
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx" || mime.includes("wordprocessingml")) {
    const { extractOfficeText } = await import("@/lib/office-text");
    const text = await extractOfficeText(
      data,
      filename,
      mime ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    if (text) return text;
  }
  if (ext === "pdf" || mime === "application/pdf") {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return extractPdfTextBestEffort(bytes);
  }
  return extractPlainKnowledgeText(
    data instanceof Uint8Array ? data : new Uint8Array(data),
    filename,
    mime,
  );
}

/** Best-effort PDF extract (uncompressed string literals). Same idea as fetch_url. */
export function extractPdfTextBestEffort(bytes: Uint8Array): string {
  const asLatin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){3,}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(asLatin)) && chunks.length < 400) {
    const inner = m[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\(.)/g, "$1");
    if (/[A-Za-z]{3,}/.test(inner)) chunks.push(inner);
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
