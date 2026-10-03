/**
 * Bubblewrap sandbox for the native VM agent.
 * No network. Host environment is cleared. File paths stay inside one
 * conversation directory. This module does not import Next.
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import {
  MAX_PUBLISHED_BYTES,
  MAX_PUBLISHED_FILES,
  mimeForPublishedExtension,
  PUBLISHED_EXTENSIONS,
  type SandboxFilePayload,
} from "./publish-files";
import { sandboxDirectoryKey } from "./sandbox-key";
import { pruneOldSandboxes } from "@/lib/trueforge/sandbox-prune";

export const SANDBOX_UNAVAILABLE = "The sandbox is unavailable this turn.";

export const SANDBOX_LIMITS = {
  timeoutMs: 60_000,
  /** Virtual address space (ulimit -v). High enough for Python, numpy, and matplotlib. */
  memoryMb: 2048,
  pids: 64,
  cpuSeconds: 30,
  maxOutputChars: 16_000,
  maxWriteChars: 500_000,
  maxCommandChars: 8_000,
} as const;

export type SandboxExecResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut?: boolean;
  aborted?: boolean;
  error?: string;
};

export interface AgentSandbox {
  exec(input: {
    command: string;
    timeoutMs: number;
    abortSignal?: AbortSignal;
  }): Promise<SandboxExecResult>;
  writeFile(relativePath: string, content: string): Promise<void>;
  readFile(relativePath: string): Promise<string>;
  list(relativePath?: string): Promise<string[]>;
  /** Files created at or after `sinceMs`. Pass `only` to read one relative path. */
  exportFiles(sinceMs: number, only?: string): Promise<SandboxFilePayload[]>;
}

export class SandboxPathError extends Error {
  constructor() {
    super("That path is not in the workspace.");
    this.name = "SandboxPathError";
  }
}

type PathKind = "missing" | "dir" | "file" | "symlink" | "other";

type SandboxChild = {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
};

export type SandboxSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: ["ignore", "pipe", "pipe"] },
) => SandboxChild;

const prunedRoots = new Set<string>();

export function nativeSandboxRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env.AETHER_SANDBOX_DIR?.trim();
  if (configured) return configured;
  const base = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "aether-agent", "sandboxes");
}

/**
 * One limit per call. `/bin/sh` on Ubuntu is dash: it accepts a single limit
 * and uses `-p` for processes, so `ulimit -v N -u N -t N` exits 125.
 */
export const SANDBOX_ULIMIT_SCRIPT =
  'ulimit -v "$1" && ulimit -p "$2" && ulimit -t "$3" || exit 125; exec /bin/sh -c "$4"';

/** How many bubblewrap commands may run at once. The per-run virtual limit stays 2048 MB. */
export const SANDBOX_MAX_CONCURRENT = 2;

let activeSandboxRuns = 0;
const sandboxWaiters: Array<() => void> = [];

export function resetSandboxSlotsForTests(): void {
  activeSandboxRuns = 0;
  sandboxWaiters.length = 0;
}

function acquireSandboxSlot(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  if (activeSandboxRuns < SANDBOX_MAX_CONCURRENT) {
    activeSandboxRuns += 1;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const grant = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      const index = sandboxWaiters.indexOf(grant);
      if (index >= 0) sandboxWaiters.splice(index, 1);
      resolve(false);
    };
    sandboxWaiters.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseSandboxSlot(): void {
  const next = sandboxWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeSandboxRuns = Math.max(0, activeSandboxRuns - 1);
}

/** Relative path inside `root`. Rejects NUL and `..`. */
export function resolveSandboxPath(root: string, relative: string, allowRoot = false): string {
  if (relative.includes("\0")) throw new SandboxPathError();
  const trimmed = relative.trim();
  if (!trimmed || trimmed === ".") {
    if (allowRoot) return path.resolve(root);
    throw new SandboxPathError();
  }
  if (path.isAbsolute(trimmed)) throw new SandboxPathError();
  const parts = trimmed.split(/[/\\]+/).filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) throw new SandboxPathError();
  const resolved = path.resolve(root, ...parts);
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new SandboxPathError();
  return resolved;
}

export function sandboxMountArgs(
  kind: (absPath: string) => PathKind,
  readlink: (absPath: string) => string,
): string[] {
  const args: string[] = [];
  if (kind("/usr") !== "missing") args.push("--ro-bind", "/usr", "/usr");
  for (const dir of ["/bin", "/lib", "/lib64"]) {
    const found = kind(dir);
    if (found === "symlink") {
      const target = readlink(dir);
      const relative = target.startsWith("/") ? path.relative("/", target) : target;
      args.push("--symlink", relative.replace(/\\/g, "/"), dir);
    } else if (found === "dir") {
      args.push("--ro-bind", dir, dir);
    }
  }
  if (kind("/etc/ld.so.cache") === "file" || kind("/etc/ld.so.cache") === "symlink") {
    args.push("--ro-bind", "/etc/ld.so.cache", "/etc/ld.so.cache");
  }
  if (kind("/etc/alternatives") === "dir" || kind("/etc/alternatives") === "symlink") {
    args.push("--ro-bind", "/etc/alternatives", "/etc/alternatives");
  }
  return args;
}

export function hostSandboxMountArgs(): string[] {
  return sandboxMountArgs(
    (absPath) => {
      try {
        const stat = fs.lstatSync(absPath);
        if (stat.isSymbolicLink()) return "symlink";
        if (stat.isDirectory()) return "dir";
        if (stat.isFile()) return "file";
        return "other";
      } catch {
        return "missing";
      }
    },
    (absPath) => fs.readlinkSync(absPath),
  );
}

/** Argv after the bwrap binary. The command is one element, not a host shell. */
export function bubblewrapArgs(input: {
  workspace: string;
  command: string;
  mounts?: readonly string[];
}): string[] {
  const memoryKb = SANDBOX_LIMITS.memoryMb * 1024;
  return [
    "--clearenv",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-net",
    "--unshare-uts",
    "--unshare-ipc",
    "--die-with-parent",
    ...(input.mounts ?? hostSandboxMountArgs()),
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    input.workspace,
    "/workspace",
    "--chdir",
    "/workspace",
    "--setenv",
    "HOME",
    "/workspace",
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "MPLBACKEND",
    "Agg",
    "--setenv",
    "MPLCONFIGDIR",
    "/tmp",
    "--setenv",
    "PYTHONDONTWRITEBYTECODE",
    "1",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--",
    "/bin/sh",
    "-c",
    SANDBOX_ULIMIT_SCRIPT,
    "sandbox",
    String(memoryKb),
    String(SANDBOX_LIMITS.pids),
    String(SANDBOX_LIMITS.cpuSeconds),
    input.command,
  ];
}

function defaultSpawn(command: string, args: readonly string[], options: { stdio: ["ignore", "pipe", "pipe"] }): SandboxChild {
  const child: ChildProcess = nodeSpawn(command, args, options);
  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    on(event: "error" | "close", listener: (...listenerArgs: never[]) => void) {
      child.on(event, listener as (...args: unknown[]) => void);
    },
  };
}

function defaultKill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process already exited.
  }
}

async function readCapped(stream: Readable | null, maxChars: number): Promise<string> {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (total < maxChars) chunks.push(buffer.subarray(0, maxChars - total));
    total += buffer.length;
    if (total > maxChars * 4) {
      stream.destroy();
      break;
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return total > maxChars ? `${text}\n[output truncated]` : text;
}

function bwrapFailure(error: unknown, stderr: string): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOENT") return true;
  return stderr.trimStart().startsWith("bwrap:");
}

export async function pruneNativeSandboxes(env: Record<string, string | undefined> = process.env): Promise<string[]> {
  try {
    return await pruneOldSandboxes(nativeSandboxRoot(env));
  } catch {
    return [];
  }
}

async function prepareWorkspace(root: string, userId: string, conversationId: string): Promise<string | null> {
  const key = sandboxDirectoryKey(userId, conversationId);
  if (!key) return null;
  if (!prunedRoots.has(root)) {
    prunedRoots.add(root);
    try {
      await pruneOldSandboxes(root);
    } catch {
      // A failed cleanup does not block the turn.
    }
  }
  const dir = path.join(root, key);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

async function collectSandboxFiles(root: string, sinceMs: number, only?: string): Promise<SandboxFilePayload[]> {
  const found: Array<SandboxFilePayload & { mtimeMs: number }> = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      let stat: fs.Stats;
      try {
        stat = await fsp.lstat(abs);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await walk(abs, relative, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      const ext = entry.name.includes(".") ? (entry.name.split(".").pop()?.toLowerCase() ?? "") : "";
      if (!PUBLISHED_EXTENSIONS.has(ext)) continue;
      const filename = relative.split(path.sep).join("/");
      if (only && filename !== only) continue;
      if (!only && stat.mtimeMs + 5 < sinceMs) continue;
      if (stat.size <= 0 || stat.size > MAX_PUBLISHED_BYTES) continue;
      const buffer = await fsp.readFile(abs);
      const mime = mimeForPublishedExtension(ext);
      found.push({
        filename,
        mime,
        bytes: buffer.length,
        dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
        mtimeMs: stat.mtimeMs,
      });
    }
  };
  await walk(root, "", 0);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const picked = only ? found.slice(0, 1) : found.slice(0, MAX_PUBLISHED_FILES);
  return picked.map((file) => ({
    filename: file.filename,
    mime: file.mime,
    bytes: file.bytes,
    dataUrl: file.dataUrl,
  }));
}

export function resetSandboxPruneForTests(): void {
  prunedRoots.clear();
}

let probeCache: Promise<boolean> | null = null;

export function resetBubblewrapProbeForTests(): void {
  probeCache = null;
}

export function bubblewrapAvailable(options?: {
  spawn?: SandboxSpawn;
  bwrapPath?: string;
}): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    const spawnImpl = options?.spawn ?? defaultSpawn;
    const binary = options?.bwrapPath ?? "bwrap";
    return new Promise((resolve) => {
      let child: SandboxChild;
      try {
        child = spawnImpl(binary, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        resolve(false);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (child.pid != null && !options?.spawn) defaultKill(child.pid);
        resolve(false);
      }, 5_000);
      const finish = (available: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(available);
      };
      let stderr = "";
      child.stdout?.resume();
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += String(chunk);
      });
      child.on("error", () => finish(false));
      child.on("close", (code) => {
        if (stderr.trimStart().startsWith("bwrap:") && code !== 0) {
          finish(false);
          return;
        }
        finish(code === 0);
      });
    });
  };
  if (options?.spawn || options?.bwrapPath) return run();
  probeCache ??= run();
  return probeCache;
}

export function createBubblewrapSandbox(options: {
  conversationId: string;
  userId: string;
  env?: Record<string, string | undefined>;
  rootDir?: string;
  spawn?: SandboxSpawn;
  killProcess?: (pid: number) => void;
  bwrapPath?: string;
  mounts?: readonly string[];
}): AgentSandbox {
  const env = options.env ?? process.env;
  const root = options.rootDir ?? nativeSandboxRoot(env);
  const spawnImpl = options.spawn ?? defaultSpawn;
  const killProcess = options.killProcess ?? defaultKill;
  const binary = options.bwrapPath ?? "bwrap";
  let workspaceReady: Promise<string | null> | null = null;

  const workspace = (): Promise<string | null> => {
    workspaceReady ??= prepareWorkspace(root, options.userId, options.conversationId);
    return workspaceReady;
  };

  return {
    async exec(input) {
      const command = input.command;
      if (!command.trim() || command.includes("\0") || command.length > SANDBOX_LIMITS.maxCommandChars) {
        return {
          ok: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          error: command.trim() ? "command is too long." : "command is required.",
        };
      }
      if (input.abortSignal?.aborted) {
        return { ok: false, stdout: "", stderr: "", exitCode: null, aborted: true };
      }
      const dir = await workspace();
      if (!dir) return { ok: false, stdout: "", stderr: "", exitCode: null, error: SANDBOX_UNAVAILABLE };
      if (input.abortSignal?.aborted) {
        return { ok: false, stdout: "", stderr: "", exitCode: null, aborted: true };
      }
      const acquired = await acquireSandboxSlot(input.abortSignal);
      if (!acquired) {
        return { ok: false, stdout: "", stderr: "", exitCode: null, aborted: true };
      }
      const args = bubblewrapArgs({
        workspace: dir,
        command,
        mounts: options.mounts ?? hostSandboxMountArgs(),
      });
      let child: SandboxChild;
      try {
        child = spawnImpl(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        releaseSandboxSlot();
        return { ok: false, stdout: "", stderr: "", exitCode: null, error: SANDBOX_UNAVAILABLE };
      }
      let spawnError: unknown = null;
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on("error", (error) => {
          spawnError = error;
          resolve({ code: null, signal: null });
        });
        child.on("close", (code, signal) => resolve({ code, signal }));
      });
      let timedOut = false;
      let aborted = false;
      const kill = () => {
        if (child.pid != null) killProcess(child.pid);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, input.timeoutMs);
      const onAbort = () => {
        aborted = true;
        kill();
      };
      input.abortSignal?.addEventListener("abort", onAbort, { once: true });
      let stdout = "";
      let stderr = "";
      let status: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null };
      try {
        [stdout, stderr, status] = await Promise.all([
          readCapped(child.stdout, SANDBOX_LIMITS.maxOutputChars),
          readCapped(child.stderr, SANDBOX_LIMITS.maxOutputChars),
          closed,
        ]);
      } finally {
        clearTimeout(timer);
        input.abortSignal?.removeEventListener("abort", onAbort);
        releaseSandboxSlot();
      }
      if (bwrapFailure(spawnError, stderr)) {
        return { ok: false, stdout: "", stderr: "", exitCode: status.code, error: SANDBOX_UNAVAILABLE };
      }
      const exitCode = status.code;
      return {
        ok: exitCode === 0 && !timedOut && !aborted,
        stdout,
        stderr,
        exitCode,
        timedOut,
        aborted,
      };
    },
    async writeFile(relativePath, content) {
      if (content.length > SANDBOX_LIMITS.maxWriteChars) {
        throw new Error("content is too long.");
      }
      const dir = await workspace();
      if (!dir) throw new Error(SANDBOX_UNAVAILABLE);
      const target = resolveSandboxPath(dir, relativePath);
      await assertNoSymlinkEscape(dir, target);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content, "utf8");
    },
    async readFile(relativePath) {
      const dir = await workspace();
      if (!dir) throw new Error(SANDBOX_UNAVAILABLE);
      const target = resolveSandboxPath(dir, relativePath);
      await assertNoSymlinkEscape(dir, target);
      const buffer = await fsp.readFile(target);
      if (buffer.includes(0)) return `Binary file (${buffer.length} bytes).`;
      const text = buffer.toString("utf8");
      if (text.length <= SANDBOX_LIMITS.maxOutputChars) return text;
      return `${text.slice(0, SANDBOX_LIMITS.maxOutputChars)}\n[output truncated]`;
    },
    async list(relativePath = "") {
      const dir = await workspace();
      if (!dir) throw new Error(SANDBOX_UNAVAILABLE);
      const target = resolveSandboxPath(dir, relativePath, true);
      await assertNoSymlinkEscape(dir, target);
      const entries = await fsp.readdir(target, { withFileTypes: true });
      return entries.slice(0, 200).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    },
    async exportFiles(sinceMs, only) {
      const dir = await workspace();
      if (!dir) return [];
      return collectSandboxFiles(dir, sinceMs, only);
    },
  };
}

async function assertNoSymlinkEscape(root: string, target: string): Promise<void> {
  const base = await fsp.realpath(root);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new SandboxPathError();
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new SandboxPathError();
  let current = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    const next = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = await fsp.lstat(next);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") return;
      throw new SandboxPathError();
    }
    if (stat.isSymbolicLink()) throw new SandboxPathError();
    if (!stat.isDirectory()) return;
    current = next;
  }
}
