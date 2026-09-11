import { createHash } from "node:crypto";
import path from "node:path";
import { Sandbox } from "@vercel/sandbox";

const WORKSPACE_ROOT = "/vercel/sandbox/workspace";
const MAX_COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 64 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PUBLISH_BYTES = 3 * 1024 * 1024;
const SANDBOX_TIMEOUT_MS = 15 * 60_000;
const SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

export const WORKSPACE_UNAVAILABLE_MESSAGE =
  "The isolated workspace is unavailable. For a PowerPoint file use create_presentation; for Excel use create_spreadsheet. Do not substitute a markdown briefing when the user asked for a real file.";

export type WorkspaceIdentity = {
  userId?: string | null;
  conversationId?: string | null;
};

export type WorkspaceSandbox = {
  runCommand: (input: {
    cmd: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<{
    exitCode: number;
    stdout: () => Promise<string>;
    stderr: () => Promise<string>;
    durationMs?: number;
  }>;
  mkDir: (dir: string) => Promise<unknown>;
  readFileToBuffer: (input: { path: string }) => Promise<Buffer | null | undefined>;
  writeFiles: (files: Array<{ path: string; content: Buffer }>) => Promise<unknown>;
};

export type WorkspaceDeps = {
  getSandbox?: (identity: WorkspaceIdentity) => Promise<WorkspaceSandbox>;
};

export type SandboxAccessTokenAuth = {
  token: string;
  teamId: string;
  projectId: string;
};

/**
 * Explicit access-token auth for Sandbox.create / getOrCreate.
 *
 * Only `VERCEL_TOKEN` (a personal/access token) is eligible. Passing
 * `VERCEL_OIDC_TOKEN` as `token` skips the SDK's `getVercelOidcToken()`
 * refresh and can pin an expired snapshot — that is how production
 * workspace_exec fails even when OIDC is enabled.
 *
 * When this returns null, the SDK authenticates via request-scoped OIDC.
 */
export function sandboxAuthFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): SandboxAccessTokenAuth | null {
  const token = (env.VERCEL_TOKEN || "").trim();
  const teamId = (env.VERCEL_TEAM_ID || env.VERCEL_ORG_ID || "").trim();
  const projectId = (env.VERCEL_PROJECT_ID || "").trim();
  if (token && teamId && projectId) return { token, teamId, projectId };
  return null;
}

export function workspaceName(identity: WorkspaceIdentity): string {
  if (!identity.conversationId?.trim()) {
    throw new Error("conversation scope is required");
  }
  const scope = `${identity.userId || "guest"}:${identity.conversationId}`;
  const digest = createHash("sha256").update(scope).digest("hex").slice(0, 24);
  return `aether-${digest}`;
}

export function sandboxCreateParams(
  identity: WorkspaceIdentity,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
  const auth = sandboxAuthFromEnv(env);
  return {
    name: workspaceName(identity),
    persistent: true as const,
    timeout: SANDBOX_TIMEOUT_MS,
    resources: { vcpus: 1 as const },
    image: "vercel/sandbox/universal" as const,
    snapshotExpiration: SNAPSHOT_EXPIRATION_MS,
    ...(auth ?? {}),
  };
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

export function classifyWorkspaceError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/conversation scope is required/i.test(message)) {
    return "This chat has no workspace yet. Retry the command in this conversation.";
  }
  return WORKSPACE_UNAVAILABLE_MESSAGE;
}

function logWorkspaceFailure(op: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[workspace]", op, {
    message: message.slice(0, 240),
    hasOidc: Boolean(process.env.VERCEL_OIDC_TOKEN?.trim()),
    hasAccessToken: Boolean(process.env.VERCEL_TOKEN?.trim()),
    hasTeam: Boolean(
      process.env.VERCEL_TEAM_ID?.trim() || process.env.VERCEL_ORG_ID?.trim(),
    ),
    hasProject: Boolean(process.env.VERCEL_PROJECT_ID?.trim()),
  });
}

function isRetryableWorkspaceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /429|503|502|504|ETIMEDOUT|ECONNRESET|snapshot not found|temporarily unavailable/i.test(
    message,
  );
}

async function ensureWorkspaceRoot(sandbox: WorkspaceSandbox) {
  try {
    await sandbox.runCommand({
      cmd: "mkdir",
      args: ["-p", WORKSPACE_ROOT],
      timeoutMs: 10_000,
    });
    return;
  } catch (err) {
    try {
      await sandbox.mkDir("workspace");
    } catch (mkdirErr) {
      logWorkspaceFailure("mkdir", mkdirErr ?? err);
    }
  }
}

async function getWorkspace(identity: WorkspaceIdentity): Promise<WorkspaceSandbox> {
  const params = sandboxCreateParams(identity);
  const create = async () =>
    Sandbox.getOrCreate({
      ...params,
      onCreate: async (sandbox) => {
        try {
          await ensureWorkspaceRoot(sandbox);
        } catch (err) {
          logWorkspaceFailure("onCreate", err);
        }
      },
    });

  let sandbox: WorkspaceSandbox;
  try {
    sandbox = await create();
  } catch (err) {
    if (!isRetryableWorkspaceError(err)) throw err;
    logWorkspaceFailure("getOrCreate-retry", err);
    sandbox = await create();
  }
  await ensureWorkspaceRoot(sandbox);
  return sandbox;
}

function sandboxOf(
  identity: WorkspaceIdentity,
  deps?: WorkspaceDeps,
): Promise<WorkspaceSandbox> {
  return (deps?.getSandbox ?? getWorkspace)(identity);
}

export async function workspaceExec(
  identity: WorkspaceIdentity,
  input: { command: string; timeoutMs?: number },
  deps?: WorkspaceDeps,
) {
  const command = input.command.trim();
  if (!command) return { ok: false, error: "command is required." };
  if (!identity.conversationId?.trim()) {
    return { ok: false, error: classifyWorkspaceError(new Error("conversation scope is required")) };
  }
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? 30_000, 1_000),
    MAX_COMMAND_TIMEOUT_MS,
  );
  try {
    const sandbox = await sandboxOf(identity, deps);
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
  } catch (err) {
    logWorkspaceFailure("exec", err);
    return { ok: false, error: classifyWorkspaceError(err) };
  }
}

export async function workspaceReadFile(
  identity: WorkspaceIdentity,
  input: { path: string },
  deps?: WorkspaceDeps,
) {
  const resolved = resolveWorkspacePath(input.path);
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  if (!identity.conversationId?.trim()) {
    return { ok: false, error: classifyWorkspaceError(new Error("conversation scope is required")) };
  }
  try {
    const sandbox = await sandboxOf(identity, deps);
    const content = await sandbox.readFileToBuffer({ path: resolved });
    if (!content) return { ok: false, error: "File not found." };
    if (content.byteLength > MAX_FILE_BYTES) {
      return { ok: false, error: "File is larger than the 1 MB read limit." };
    }
    return { ok: true, path: input.path, content: content.toString("utf8") };
  } catch (err) {
    logWorkspaceFailure("read", err);
    return { ok: false, error: "Could not read that workspace file." };
  }
}

export async function workspaceReadBinary(
  identity: WorkspaceIdentity,
  input: { path: string },
  deps?: WorkspaceDeps,
): Promise<
  | { ok: true; path: string; buffer: Buffer }
  | { ok: false; error: string }
> {
  const resolved = resolveWorkspacePath(input.path);
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  if (!identity.conversationId?.trim()) {
    return { ok: false, error: classifyWorkspaceError(new Error("conversation scope is required")) };
  }
  try {
    const sandbox = await sandboxOf(identity, deps);
    const content = await sandbox.readFileToBuffer({ path: resolved });
    if (!content) return { ok: false, error: "File not found." };
    if (content.byteLength > MAX_PUBLISH_BYTES) {
      return { ok: false, error: "File is larger than the 3 MB publish limit." };
    }
    return { ok: true, path: input.path, buffer: Buffer.from(content) };
  } catch (err) {
    logWorkspaceFailure("read-binary", err);
    return { ok: false, error: WORKSPACE_UNAVAILABLE_MESSAGE };
  }
}

export async function workspaceWriteFile(
  identity: WorkspaceIdentity,
  input: { path: string; content: string },
  deps?: WorkspaceDeps,
) {
  const resolved = resolveWorkspacePath(input.path);
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  if (!identity.conversationId?.trim()) {
    return { ok: false, error: classifyWorkspaceError(new Error("conversation scope is required")) };
  }
  const content = Buffer.from(input.content, "utf8");
  if (content.byteLength > MAX_FILE_BYTES) {
    return { ok: false, error: "File is larger than the 1 MB write limit." };
  }
  try {
    const sandbox = await sandboxOf(identity, deps);
    await sandbox.mkDir(path.posix.dirname(resolved));
    await sandbox.writeFiles([{ path: resolved, content }]);
    return { ok: true, path: input.path, bytes: content.byteLength };
  } catch (err) {
    logWorkspaceFailure("write", err);
    return { ok: false, error: "Could not write that workspace file." };
  }
}

export async function workspaceListFiles(
  identity: WorkspaceIdentity,
  input: { path?: string; depth?: number },
  deps?: WorkspaceDeps,
) {
  const resolved = resolveWorkspacePath(input.path || ".");
  if (!resolved) return { ok: false, error: "A valid workspace path is required." };
  if (!identity.conversationId?.trim()) {
    return { ok: false, error: classifyWorkspaceError(new Error("conversation scope is required")) };
  }
  const depth = Math.min(Math.max(input.depth ?? 3, 1), 6);
  try {
    const sandbox = await sandboxOf(identity, deps);
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
  } catch (err) {
    logWorkspaceFailure("list", err);
    return { ok: false, error: "Could not list workspace files." };
  }
}
