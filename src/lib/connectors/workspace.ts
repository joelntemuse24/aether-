import { createHash } from "node:crypto";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";

const WORKSPACE_ROOT = "/vercel/sandbox/workspace";
const MAX_COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;

export type WorkspaceIdentity = {
  userId?: string | null;
  conversationId?: string | null;
};

function workspaceName(identity: WorkspaceIdentity): string {
  if (!identity.conversationId?.trim()) {
    throw new Error("conversation scope is required");
  }
  const scope = `${identity.userId || "guest"}:${identity.conversationId}`;
  const digest = createHash("sha256").update(scope).digest("hex").slice(0, 24);
  return `aether-${digest}`;
}

export function resolveWorkspacePath(input: string): string | null {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  const resolved = path.posix.resolve(WORKSPACE_ROOT, normalized);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(`${WORKSPACE_ROOT}/`)) {
    return null;
  }
  return resolved;
}

function capped(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_OUTPUT_CHARS) return { text: value, truncated: false };
  return {
    text: value.slice(0, MAX_OUTPUT_CHARS),
    truncated: true,
  };
}

async function getWorkspace(identity: WorkspaceIdentity): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: workspaceName(identity),
    persistent: true,
    timeout: 15 * 60_000,
    resources: { vcpus: 1 },
    tags: { product: "aether" },
    onCreate: async (sandbox) => {
      await sandbox.mkDir(WORKSPACE_ROOT);
    },
  });
}

export async function workspaceExec(
  identity: WorkspaceIdentity,
  input: { command: string; timeoutMs?: number },
) {
  const command = input.command.trim();
  if (!command) return { ok: false, error: "command is required." };
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? 30_000, 1_000),
    MAX_COMMAND_TIMEOUT_MS,
  );
  try {
    const sandbox = await getWorkspace(identity);
    const result = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", command],
      cwd: WORKSPACE_ROOT,
      timeoutMs,
    });
    const [stdoutRaw, stderrRaw] = await Promise.all([
      result.stdout(),
      result.stderr(),
    ]);
    const stdout = capped(stdoutRaw);
    const stderr = capped(stderrRaw);
    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      durationMs: result.durationMs,
    };
  } catch {
    return { ok: false, error: "The isolated workspace is unavailable right now." };
  }
}

export async function workspaceReadFile(
  identity: WorkspaceIdentity,
  input: { path: string },
) {
  const resolved = resolveWorkspacePath(input.path);
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  try {
    const sandbox = await getWorkspace(identity);
    const content = await sandbox.readFileToBuffer({ path: resolved });
    if (!content) return { ok: false, error: "File not found." };
    if (content.byteLength > MAX_FILE_BYTES) {
      return { ok: false, error: "File is larger than the 1 MB read limit." };
    }
    return { ok: true, path: input.path, content: content.toString("utf8") };
  } catch {
    return { ok: false, error: "Could not read that workspace file." };
  }
}

export async function workspaceWriteFile(
  identity: WorkspaceIdentity,
  input: { path: string; content: string },
) {
  const resolved = resolveWorkspacePath(input.path);
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  const content = Buffer.from(input.content, "utf8");
  if (content.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: "File is larger than the 1 MB write limit." };
  }
  try {
    const sandbox = await getWorkspace(identity);
    await sandbox.mkDir(path.posix.dirname(resolved));
    await sandbox.writeFiles([{ path: resolved, content }]);
    return { ok: true, path: input.path, bytes: content.byteLength };
  } catch {
    return { ok: false, error: "Could not write that workspace file." };
  }
}

export async function workspaceListFiles(
  identity: WorkspaceIdentity,
  input: { path?: string; depth?: number },
) {
  const resolved = resolveWorkspacePath(input.path || ".");
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  const depth = Math.min(Math.max(input.depth ?? 3, 1), 6);
  try {
    const sandbox = await getWorkspace(identity);
    const result = await sandbox.runCommand({
      cmd: "find",
      args: [resolved, "-maxdepth", String(depth), "-mindepth", "1", "-printf", "%y %P\n"],
      cwd: WORKSPACE_ROOT,
      timeoutMs: 10_000,
    });
    const output = capped(await result.stdout());
    return {
      ok: result.exitCode === 0,
      path: input.path || ".",
      entries: output.text.split("\n").filter(Boolean),
      truncated: output.truncated,
    };
  } catch {
    return { ok: false, error: "Could not list workspace files." };
  }
}
