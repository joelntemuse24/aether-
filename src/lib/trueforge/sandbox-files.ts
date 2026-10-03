import { fileToolResult, type FileToolResult } from "@/lib/artifacts/file-result";
import { bufferToDataUrl, mimeForFilename } from "@/lib/office/file-artifact";
import type { UiChunk } from "./ui-chunks";

export type SandboxFileRef = { label: string; path: string };

const PUBLISH_EXT = /\.(?:pptx|xlsx|xls|docx|pdf|png|jpe?g|webp|gif|csv|zip|svg|html?)$/i;

const PANEL_EXT = /\.(?:svg|html?)$/i;

/** Bytes kept in the thread. Larger files are skipped rather than shown as a private path. */
export const SANDBOX_FILE_BYTE_CAP = 3_000_000;

export function isHiddenSandboxPath(filePath: string): boolean {
  if (!filePath || filePath.startsWith("http://") || filePath.startsWith("https://")) return false;
  if (filePath.startsWith("/api/")) return false;
  if (filePath.includes("trueforge-aether/sandboxes")) return true;
  if (filePath.includes("/.local/share/") && filePath.includes("/sandboxes/")) return true;
  if (filePath.startsWith("/home/") && (filePath.includes("/sandboxes/") || PUBLISH_EXT.test(filePath))) {
    return true;
  }
  return false;
}

export function isPublishableSandboxPath(filePath: string): boolean {
  const clean = filePath.split("?")[0] ?? filePath;
  return isHiddenSandboxPath(clean) && PUBLISH_EXT.test(clean);
}

/** html and svg open in the preview panel instead of a download card. */
export function isPanelSandboxPath(filePath: string): boolean {
  return PANEL_EXT.test(filePath.split("?")[0] ?? filePath);
}

export function sandboxPanelKind(filePath: string): "html" | "svg" {
  return /\.svg$/i.test(filePath.split("?")[0] ?? filePath) ? "svg" : "html";
}

export function sandboxFileName(filePath: string): string {
  const base = (filePath.split("?")[0] ?? filePath).split("/").filter(Boolean).pop() || "download";
  const clean = base.replace(/[^\w.\- ()]/g, "_").slice(0, 180);
  return clean || "download";
}

function isFenceFile(filePath: string): boolean {
  const clean = filePath.split("?")[0] ?? filePath;
  if (!PUBLISH_EXT.test(clean)) return false;
  if (filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("/api/")) {
    return false;
  }
  return !filePath.includes("..");
}

function remember(refs: SandboxFileRef[], label: string, filePath: string, allowRelative = false) {
  const path = filePath.trim();
  if (!isPublishableSandboxPath(path) && !(allowRelative && isFenceFile(path))) return;
  if (refs.some((ref) => ref.path === path)) return;
  const name = sandboxFileName(path);
  const trimmed = label.trim();
  const safeLabel =
    trimmed && !isHiddenSandboxPath(trimmed) && !trimmed.includes("/home/") ? trimmed : name;
  refs.push({ label: safeLabel, path });
}

/** Markdown links, including the `(<path>)` and `( path )` forms models emit. */
const LINK_RE = /\[([^\]]*)\]\(\s*(?:<([^<>\n]*)>|([^)\n]+?))\s*\)/g;

function linkTarget(match: RegExpExecArray): string {
  const angle = (match[2] ?? "").trim();
  if (angle) return angle;
  return (match[3] ?? "").trim();
}

function collectPaths(body: string, refs: SandboxFileRef[], fence: boolean) {
  const link = new RegExp(LINK_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = link.exec(body))) {
    const target = linkTarget(match);
    if (fence || isPublishableSandboxPath(target)) remember(refs, match[1] ?? "", target, fence);
  }
  const bare = /\/(?:home\/|\.local\/share\/)[^\s)\]"'<>]+/g;
  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = bare.exec(body))) {
    remember(refs, sandboxFileName(pathMatch[0]), pathMatch[0]);
  }
}

/** A line that is only the `sandbox_artifacts` marker opens a file block even without a fence. */
export function isSandboxHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed === "sandbox_artifacts" ||
    trimmed === "[sandbox_artifacts]" ||
    trimmed === "[sandbox_artifacts]:"
  );
}

/**
 * Hold from an unfenced header while its block is still open (no blank line
 * after it yet), so links that arrive in later chunks are still collected.
 */
function openSandboxHeaderIndex(text: string): number {
  const lines = text.split("\n");
  let offset = 0;
  let found = -1;
  for (const line of lines) {
    if (isSandboxHeaderLine(line)) found = offset;
    offset += line.length + 1;
  }
  if (found < 0) return -1;
  if (text.slice(found).includes("\n\n")) return -1;
  return found;
}

/** Collect and drop the links in an unfenced `sandbox_artifacts` block. */
function stripUnfencedSandboxBlock(text: string, refs: SandboxFileRef[]): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    if (isSandboxHeaderLine(line)) {
      inBlock = true;
      continue;
    }
    const blank = line.trim() === "";
    if (!inBlock || blank) {
      if (blank) inBlock = false;
      out.push(line);
      continue;
    }
    const kept = line.replace(
      new RegExp(LINK_RE.source, "g"),
      (all: string, label: string, angle?: string, plain?: string) => {
        const target = ((angle ?? "").trim() || (plain ?? "").trim()) as string;
        if (!target) return all;
        if (isPublishableSandboxPath(target) || isFenceFile(target)) {
          remember(refs, label, target, true);
          return label.trim() ? label : "";
        }
        return all;
      },
    );
    out.push(kept);
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function holdIndex(text: string): number {
  const points: number[] = [];
  const fenceCount = text.split("```").length - 1;
  if (fenceCount % 2 === 1) points.push(text.lastIndexOf("```"));
  const ticks = text.match(/`{1,2}$/);
  if (ticks?.index != null && !text.endsWith("```")) points.push(ticks.index);

  const linkStart = text.lastIndexOf("[");
  if (linkStart >= 0) {
    const tail = text.slice(linkStart);
    const completeCitation = /^\[[^\]]*\](?!\()/.test(tail);
    const completeLink = /^\[[^\]]*\]\([^)\n]*\)/.test(tail);
    const fileish = tail.includes("](") || tail.includes("/") || /sandbox/i.test(tail);
    const openLabel = !tail.includes("]") && tail.length < 80;
    if (!completeCitation && !completeLink && (fileish || openLabel) && tail.length < 500) {
      points.push(linkStart);
    }
  }

  const home = text.match(/\/home(?:\/[^\s)\]"'<>]*)?$/);
  if (home?.index != null && !PUBLISH_EXT.test(home[0])) points.push(home.index);
  const local = text.match(/\/(?:[\w.+-]+\/)*\.local(?:\/[^\s)\]"'<>]*)?$/);
  if (local?.index != null && !PUBLISH_EXT.test(local[0])) points.push(local.index);

  const openHeader = openSandboxHeaderIndex(text);
  if (openHeader >= 0) points.push(openHeader);

  if (points.length === 0) return text.length;
  return Math.min(...points);
}

/**
 * Drop sandbox paths from assistant text and remember files to publish.
 * Incomplete fences and paths stay in `held` until a later chunk or a flush.
 */
export function redactSandboxText(
  text: string,
  options?: { flush?: boolean },
): { visible: string; held: string; refs: SandboxFileRef[] } {
  const flush = options?.flush === true;
  const cut = flush ? text.length : holdIndex(text);
  const ready = text.slice(0, cut);
  const held = flush ? "" : text.slice(cut);
  const refs: SandboxFileRef[] = [];
  let visible = ready.replace(/```sandbox_artifacts[^\n]*\n?([\s\S]*?)```/g, (_all, body: string) => {
    collectPaths(String(body), refs, true);
    return "";
  });
  if (flush) {
    visible = visible.replace(/```sandbox_artifacts[\s\S]*$/g, (block) => {
      collectPaths(block, refs, true);
      return "";
    });
  }
  visible = stripUnfencedSandboxBlock(visible, refs);
  visible = visible.replace(new RegExp(LINK_RE.source, "g"), (all, label: string, angle?: string, plain?: string) => {
    const target = ((angle ?? "").trim() || (plain ?? "").trim()) as string;
    if (!target || !isPublishableSandboxPath(target)) return all;
    remember(refs, label, target);
    return label;
  });
  visible = visible.replace(/\/(?:home\/|\.local\/share\/)[^\s)\]"'<>]+/g, (path: string) => {
    if (!isHiddenSandboxPath(path)) return path;
    if (isPublishableSandboxPath(path)) remember(refs, sandboxFileName(path), path);
    return isPublishableSandboxPath(path) ? sandboxFileName(path) : "";
  });
  visible = visible.replace(/\n{3,}/g, "\n\n");
  return { visible, held, refs };
}

export function redactSandboxValue(value: unknown, refs: SandboxFileRef[]): unknown {
  if (typeof value === "string") {
    const fed = redactSandboxText(value, { flush: true });
    for (const ref of fed.refs) {
      if (!refs.some((existing) => existing.path === ref.path)) refs.push(ref);
    }
    return fed.visible;
  }
  if (Array.isArray(value)) return value.map((item) => redactSandboxValue(item, refs));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactSandboxValue(item, refs);
    }
    return out;
  }
  return value;
}

export function sandboxFileCardChunks(result: FileToolResult, index: number): UiChunk[] {
  const toolCallId = `sandbox-file-${index + 1}`;
  return [
    {
      type: "tool-input-available",
      toolCallId,
      toolName: "create_artifact",
      providerExecuted: true,
      input: {
        title: result.title,
        kind: "file",
        language: result.filename,
      },
    },
    {
      type: "tool-output-available",
      toolCallId,
      providerExecuted: true,
      output: result,
    },
  ];
}

export async function sandboxFileCards(input: {
  refs: SandboxFileRef[];
  load: (filePath: string) => Promise<Uint8Array | Buffer | null>;
  persist?: (file: {
    title: string;
    filename: string;
    mime: string;
    dataUrl: string;
  }) => Promise<{ id?: string; persisted: boolean }>;
}): Promise<UiChunk[]> {
  const chunks: UiChunk[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const ref of input.refs) {
    if (seen.has(ref.path)) continue;
    seen.add(ref.path);
    let bytes: Uint8Array | Buffer | null = null;
    for (const candidate of downloadCandidates(ref.path)) {
      try {
        bytes = await input.load(candidate);
      } catch {
        bytes = null;
      }
      if (bytes && bytes.byteLength > 0) break;
    }
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > SANDBOX_FILE_BYTE_CAP) continue;
    const filename = sandboxFileName(ref.path);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const title = ref.label || filename;
    if (isPanelSandboxPath(ref.path)) {
      chunks.push(
        ...sandboxPanelArtifactChunks(
          {
            title,
            filename,
            kind: sandboxPanelKind(ref.path),
            content: buffer.toString("utf8"),
          },
          index,
        ),
      );
      index += 1;
      continue;
    }
    const mime = mimeForFilename(filename);
    const dataUrl = bufferToDataUrl(buffer, mime);
    const saved = input.persist
      ? await input.persist({ title, filename, mime, dataUrl })
      : { persisted: false };
    chunks.push(
      ...sandboxFileCardChunks(
        fileToolResult({
          title,
          filename,
          mime,
          bytes: buffer.byteLength,
          dataUrl,
          saved,
        }),
        index,
      ),
    );
    index += 1;
  }
  return chunks;
}

/**
 * A model path that drops the sandbox subfolder still names the file. The
 * download endpoint resolves a bare name against the turn's sandbox root, so
 * retry the basename when the listed path misses.
 */
export function downloadCandidates(filePath: string): string[] {
  const clean = filePath.split("?")[0] ?? filePath;
  const base = clean.split("/").filter(Boolean).pop() ?? "";
  const out = [filePath];
  if (base && base !== clean && isFenceFile(base)) out.push(base);
  return out;
}

/** An html or svg sandbox file opens in the preview panel, like a fenced block. */
export function sandboxPanelArtifactChunks(
  input: { title: string; filename: string; kind: "html" | "svg"; content: string },
  index: number,
): UiChunk[] {
  const toolCallId = `sandbox-file-${index + 1}`;
  return [
    {
      type: "tool-input-available",
      toolCallId,
      toolName: "create_artifact",
      providerExecuted: true,
      input: {
        title: input.title,
        kind: input.kind,
        language: input.filename,
      },
    },
    {
      type: "tool-output-available",
      toolCallId,
      providerExecuted: true,
      output: {
        ok: true,
        kind: input.kind,
        title: input.title,
        filename: input.filename,
        content: input.content,
      },
    },
  ];
}
