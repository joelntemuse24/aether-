import { fileToolResult, type FileToolResult } from "@/lib/artifacts/file-result";
import { bufferToDataUrl, mimeForFilename } from "@/lib/office/file-artifact";
import type { UiChunk } from "./ui-chunks";

export type SandboxFileRef = { label: string; path: string };

const PUBLISH_EXT = /\.(?:pptx|xlsx|xls|docx|pdf|png|jpe?g|webp|gif|csv|zip|svg)$/i;

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

function collectPaths(body: string, refs: SandboxFileRef[], fence: boolean) {
  const link = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = link.exec(body))) {
    const target = match[2] ?? "";
    if (fence || isPublishableSandboxPath(target)) remember(refs, match[1] ?? "", target, fence);
  }
  const bare = /\/(?:home\/|\.local\/share\/)[^\s)\]"'<>]+/g;
  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = bare.exec(body))) {
    remember(refs, sandboxFileName(pathMatch[0]), pathMatch[0]);
  }
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
  visible = visible.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (all, label: string, target: string) => {
    if (!isPublishableSandboxPath(target)) return all;
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
    try {
      bytes = await input.load(ref.path);
    } catch {
      bytes = null;
    }
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > SANDBOX_FILE_BYTE_CAP) continue;
    const filename = sandboxFileName(ref.path);
    const mime = mimeForFilename(filename);
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const dataUrl = bufferToDataUrl(buffer, mime);
    const saved = input.persist
      ? await input.persist({ title: ref.label || filename, filename, mime, dataUrl })
      : { persisted: false };
    chunks.push(
      ...sandboxFileCardChunks(
        fileToolResult({
          title: ref.label || filename,
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
