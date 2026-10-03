import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { agentToolNeedsConfirmation } from "./registry";
import { definitionsForAllowList } from "./catalog";
import { executeSandboxTool } from "./sandbox-tools";
import { nativeSandboxIdentity, sandboxDirectoryKey } from "./sandbox-key";
import {
  SANDBOX_LIMITS,
  SANDBOX_MAX_CONCURRENT,
  SANDBOX_ULIMIT_SCRIPT,
  SANDBOX_UNAVAILABLE,
  SandboxPathError,
  bubblewrapArgs,
  bubblewrapAvailable,
  createBubblewrapSandbox,
  nativeSandboxRoot,
  pruneNativeSandboxes,
  resetSandboxPruneForTests,
  resetSandboxSlotsForTests,
  resolveSandboxPath,
  sandboxMountArgs,
  type SandboxChild,
  type SandboxSpawn,
} from "./sandbox";

function scriptedSpawn(script: {
  pid?: number;
  stdout?: string;
  stderr?: string;
  code?: number | null;
  signal?: NodeJS.Signals | null;
  hang?: boolean;
  error?: NodeJS.ErrnoException;
  onSpawn?: (command: string, args: readonly string[]) => void;
}): { spawn: SandboxSpawn; finish: (code: number | null, signal: NodeJS.Signals | null) => void } {
  let finish: (code: number | null, signal: NodeJS.Signals | null) => void = () => {};
  const spawn: SandboxSpawn = (command, args) => {
    script.onSpawn?.(command, args);
    const listeners: {
      error?: (error: NodeJS.ErrnoException) => void;
      close?: (code: number | null, signal: NodeJS.Signals | null) => void;
    } = {};
    const child: SandboxChild = {
      pid: script.pid ?? 4242,
      stdout: Readable.from([script.stdout ?? ""]),
      stderr: Readable.from([script.stderr ?? ""]),
      on(event, listener) {
        if (event === "error") listeners.error = listener;
        if (event === "close") {
          listeners.close = listener;
          finish = listener;
        }
      },
    };
    queueMicrotask(() => {
      if (script.error) listeners.error?.(script.error);
      else if (!script.hang) listeners.close?.(script.code ?? 0, script.signal ?? null);
    });
    return child;
  };
  return { spawn, finish: (code, signal) => finish(code, signal) };
}

describe("bubblewrap sandbox", { concurrency: 1 }, () => {
  it("builds an offline argv and does not copy host secrets into it", () => {
    const previous = process.env.AETHER_HOSTED_BUZZ_API_KEY;
    process.env.AETHER_HOSTED_BUZZ_API_KEY = "sk-hosted-secret";
    try {
      const command = "python3 -c 'print(1)'";
      const args = bubblewrapArgs({
        workspace: "/tmp/aether-ws",
        command,
        mounts: ["--ro-bind", "/usr", "/usr"],
      });
      assert.equal(args.includes("--share-net"), false);
      assert.equal(args.includes("--unshare-net"), true);
      assert.equal(args.includes("--clearenv"), true);
      assert.equal(args.includes("--die-with-parent"), true);
      assert.equal(args.includes("--unshare-user"), true);
      assert.equal(args.includes("--unshare-pid"), true);
      assert.equal(args.at(-1), command);
      assert.equal(args.includes(SANDBOX_ULIMIT_SCRIPT), true);
      assert.equal(SANDBOX_ULIMIT_SCRIPT.includes("-u"), false);
      assert.equal(/ulimit[^\n]*-v[^\n]*-u/.test(SANDBOX_ULIMIT_SCRIPT), false);
      assert.equal(args.includes(String(SANDBOX_LIMITS.memoryMb * 1024)), true);
      assert.equal(args.includes(String(SANDBOX_LIMITS.pids)), true);
      assert.equal(args.includes(String(SANDBOX_LIMITS.cpuSeconds)), true);
      assert.equal(args.join("\n").includes("sk-hosted-secret"), false);
      assert.equal(args.join("\n").includes("AETHER_TRUEFORGE_TOKEN"), false);
      assert.equal(args.join("\n").includes("OPENROUTER_API_KEY"), false);
    } finally {
      if (previous === undefined) delete process.env.AETHER_HOSTED_BUZZ_API_KEY;
      else process.env.AETHER_HOSTED_BUZZ_API_KEY = previous;
    }
  });

  it("maps host library paths without binding the whole root", () => {
    const args = sandboxMountArgs(
      (absPath) => {
        if (absPath === "/usr" || absPath === "/lib" || absPath === "/etc/alternatives") return "dir";
        if (absPath === "/bin") return "symlink";
        if (absPath === "/etc/ld.so.cache") return "file";
        return "missing";
      },
      () => "usr/bin",
    );
    assert.equal(args.includes("--bind"), false);
    assert.deepEqual(args.slice(0, 3), ["--ro-bind", "/usr", "/usr"]);
    assert.deepEqual(args.slice(3, 6), ["--symlink", "usr/bin", "/bin"]);
    assert.equal(args.includes("/"), false);
  });

  it("rejects paths that leave the workspace", () => {
    const root = "/tmp/workspace";
    assert.equal(resolveSandboxPath(root, "charts/plot.png"), path.resolve(root, "charts/plot.png"));
    assert.throws(() => resolveSandboxPath(root, "../secret"), SandboxPathError);
    assert.throws(() => resolveSandboxPath(root, "foo/../../secret"), SandboxPathError);
    assert.throws(() => resolveSandboxPath(root, "bad\0name"), SandboxPathError);
    assert.equal(sandboxDirectoryKey("guest-1", ""), null);
    assert.equal(sandboxDirectoryKey("", "conversation-1"), null);
    const key = sandboxDirectoryKey("guest-1", "conversation-1");
    assert.equal(key, "guest-1--conversation-1");
    assert.equal(key?.includes("unknown"), false);
    const messy = sandboxDirectoryKey("guest-1", "../etc/passwd");
    const other = sandboxDirectoryKey("guest-2", "../etc/passwd");
    assert.equal(messy?.startsWith("guest-1--"), true);
    assert.notEqual(messy, other);
    assert.equal(messy?.includes("unknown"), false);
    const minted = nativeSandboxIdentity({ userId: null, guestId: "guest-9", conversationId: null });
    assert.equal(minted?.userId, "guest-9");
    assert.match(minted?.conversationId ?? "", /^turn-/);
    assert.equal(nativeSandboxIdentity({ userId: null, guestId: "", conversationId: "c1" }), null);
  });

  it("keeps files in the conversation directory and prunes stale ones", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-"));
    const stale = path.join(root, "old-conversation");
    fs.mkdirSync(stale);
    const old = new Date(Date.now() - 8 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    resetSandboxPruneForTests();
    const sandbox = createBubblewrapSandbox({
      conversationId: "conv-1",
      userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({}).spawn,
    });
    await sandbox.writeFile("notes/hello.txt", "hello");
    assert.equal(fs.existsSync(stale), false);
    assert.equal(await sandbox.readFile("notes/hello.txt"), "hello");
    assert.deepEqual(await sandbox.list("notes"), ["hello.txt"]);
    await assert.rejects(() => sandbox.writeFile("../secret.txt", "nope"), SandboxPathError);
    assert.equal(fs.existsSync(path.join(root, "secret.txt")), false);
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "secret");
    const workspace = path.join(root, "guest-1--conv-1");
    fs.symlinkSync(outside, path.join(workspace, "link.txt"));
    await assert.rejects(() => sandbox.writeFile("link.txt", "pwn"), SandboxPathError);
    assert.equal(fs.readFileSync(outside, "utf8"), "secret");
    const removed = await pruneNativeSandboxes({ AETHER_SANDBOX_DIR: root });
    assert.equal(removed.includes("guest-1--conv-1"), false);
    assert.equal(fs.existsSync(path.join(root, "unknown")), false);
    assert.equal(nativeSandboxRoot({ AETHER_SANDBOX_DIR: root }), root);
    assert.match(nativeSandboxRoot({}), /aether-agent\/sandboxes$/);
    assert.equal(nativeSandboxRoot({}).includes("trueforge"), false);
  });

  it("runs a command through the injected spawn and kills it on abort", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-exec-"));
    let argv: readonly string[] = [];
    const script = scriptedSpawn({
      stdout: "ok\n",
      onSpawn: (_command, args) => {
        argv = args;
      },
    });
    const sandbox = createBubblewrapSandbox({
      conversationId: "c1", userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: script.spawn,
    });
    const result = await sandbox.exec({ command: "echo hi", timeoutMs: 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "ok\n");
    assert.equal(result.exitCode, 0);
    assert.equal(argv.at(-1), "echo hi");
    assert.equal(argv.includes("--unshare-net"), true);
    assert.equal(argv.includes("--clearenv"), true);
    assert.equal(argv.includes("--share-net"), false);

    const hung = scriptedSpawn({ hang: true });
    let killed = 0;
    const abortable = createBubblewrapSandbox({
      conversationId: "c1", userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: hung.spawn,
      killProcess: (pid) => {
        killed = pid;
        hung.finish(null, "SIGKILL");
      },
    });
    const controller = new AbortController();
    const pending = abortable.exec({ command: "sleep 30", timeoutMs: 60_000, abortSignal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const aborted = await pending;
    assert.equal(killed, 4242);
    assert.equal(aborted.aborted, true);
    assert.equal(aborted.ok, false);
  });

  it("kills a command that exceeds the time limit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-time-"));
    const hung = scriptedSpawn({ hang: true, stdout: "partial" });
    let killed = 0;
    const sandbox = createBubblewrapSandbox({
      conversationId: "c1", userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: hung.spawn,
      killProcess: (pid) => {
        killed = pid;
        hung.finish(null, "SIGKILL");
      },
    });
    const result = await sandbox.exec({ command: "sleep 30", timeoutMs: 30 });
    assert.equal(killed, 4242);
    assert.equal(result.timedOut, true);
    assert.equal(result.ok, false);
  });

  it("treats a failed bwrap probe as unavailable", async () => {
    const missing = await bubblewrapAvailable({
      spawn: scriptedSpawn({ error: Object.assign(new Error("missing"), { code: "ENOENT" }) }).spawn,
    });
    assert.equal(missing, false);
    const ready = await bubblewrapAvailable({
      spawn: scriptedSpawn({ stdout: "bubblewrap 0.8.0\n", code: 0 }).spawn,
    });
    assert.equal(ready, true);
  });

  it("returns the unavailable sentence when bubblewrap cannot start", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-missing-"));
    const missing = createBubblewrapSandbox({
      conversationId: "c1", userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({ error: Object.assign(new Error("spawn bwrap ENOENT"), { code: "ENOENT" }) }).spawn,
    });
    const enoent = await missing.exec({ command: "python3 -V", timeoutMs: 1000 });
    assert.equal(enoent.error, SANDBOX_UNAVAILABLE);
    assert.equal(enoent.stderr, "");
    assert.equal(JSON.stringify(enoent).includes("ENOENT"), false);

    const denied = createBubblewrapSandbox({
      conversationId: "c1", userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({ stderr: "bwrap: setting up uid map failed", code: 1 }).spawn,
    });
    const failed = await denied.exec({ command: "python3 -V", timeoutMs: 1000 });
    assert.equal(failed.error, SANDBOX_UNAVAILABLE);
    assert.equal(JSON.stringify(failed).includes("uid map"), false);

    const tool = await executeSandboxTool("sandbox_exec", { command: "python3 -V" }, null);
    assert.deepEqual(tool, { ok: false, error: SANDBOX_UNAVAILABLE, retryable: false });
  });

  it("asks before a sandbox command and runs it in auto", async () => {
    const definition = definitionsForAllowList(["sandbox_exec"])[0];
    assert.equal(definition?.risk, "write");
    assert.equal(definition?.runsOn, "vm");
    assert.equal(
      agentToolNeedsConfirmation({ name: "sandbox_exec", risk: "write", mode: "ask" }),
      false,
    );
    assert.equal(
      agentToolNeedsConfirmation({ name: "sandbox_exec", risk: "write", mode: "auto" }),
      false,
    );
    const result = await executeSandboxTool(
      "sandbox_exec",
      { command: "python3 chart.py" },
      {
        async exec() {
          return { ok: false, stdout: "", stderr: "SyntaxError", exitCode: 1 };
        },
        async writeFile() {},
        async readFile() {
          return "name,n\n";
        },
        async list() {
          return ["chart.png"];
        },
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const data = result.data as { exitCode: number; stderr: string };
      assert.equal(data.exitCode, 1);
      assert.equal(data.stderr, "SyntaxError");
    }
  });

  it("applies limits with separate /bin/sh ulimit calls", async () => {
    const args = bubblewrapArgs({
      workspace: "/tmp/aether-ws",
      command: "echo hi",
      mounts: [],
    });
    assert.equal(args.includes(SANDBOX_ULIMIT_SCRIPT), true);
    const run = (script: string, commandArgs: string[]) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn("/bin/sh", ["-c", script, "sandbox", ...commandArgs], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
    const good = await run(SANDBOX_ULIMIT_SCRIPT, ["262144", "64", "5", "echo dash-ok"]);
    assert.equal(good.code, 0, good.stderr);
    assert.match(good.stdout, /dash-ok/);
    const shell = fs.readlinkSync("/bin/sh");
    if (shell === "dash" || shell.endsWith("/dash")) {
      const bad = await run('ulimit -v "$1" -u "$2" -t "$3" || exit 125; echo should-not-run', [
        "262144",
        "64",
        "5",
      ]);
      assert.notEqual(bad.code, 0);
      assert.equal(bad.stdout.includes("should-not-run"), false);
    }
  });

  it("gives each guest their own directory and refuses a shared folder", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-guest-"));
    const one = createBubblewrapSandbox({
      conversationId: "conversation-1",
      userId: "guest-a",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({}).spawn,
    });
    const two = createBubblewrapSandbox({
      conversationId: "conversation-1",
      userId: "guest-b",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({}).spawn,
    });
    await one.writeFile("notes.txt", "one");
    await two.writeFile("notes.txt", "two");
    assert.equal(await one.readFile("notes.txt"), "one");
    assert.equal(await two.readFile("notes.txt"), "two");
    assert.equal(fs.existsSync(path.join(root, "unknown")), false);
    const refused = createBubblewrapSandbox({
      conversationId: "",
      userId: "guest-a",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({}).spawn,
    });
    const missing = await refused.exec({ command: "echo hi", timeoutMs: 1000 });
    assert.equal(missing.error, SANDBOX_UNAVAILABLE);
    assert.equal(fs.readdirSync(root).includes("unknown"), false);
  });

  it("publishes new chart files and hides the host path", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-files-"));
    const sandbox = createBubblewrapSandbox({
      conversationId: "conversation-1",
      userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: scriptedSpawn({ stdout: "wrote /workspace/charts/plot.png\n" }).spawn,
    });
    await sandbox.writeFile("charts/plot.png", "png");
    await sandbox.writeFile(".secret.png", "nope");
    await sandbox.writeFile("build.py", "print(1)");
    const exported = await sandbox.exportFiles(0);
    assert.equal(exported.some((file) => file.filename === "charts/plot.png"), true);
    const pngPath = path.join(root, "guest-1--conversation-1", "charts", "plot.png");
    fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
    const binary = await executeSandboxTool("sandbox_files", { op: "read", path: "charts/plot.png" }, sandbox);
    assert.equal(binary.ok, true);
    assert.equal(JSON.stringify(binary).includes("Binary file"), false);
    if (binary.ok) {
      const data = binary.data as { files?: Array<{ content?: string }> };
      assert.match(data.files?.[0]?.content ?? "", /^data:image\/png;base64,/);
    }
    assert.equal(exported.some((file) => file.filename.startsWith(".")), false);
    assert.equal(exported.some((file) => file.filename.endsWith(".py")), false);
    assert.equal(JSON.stringify(exported).includes(root), false);
    const result = await executeSandboxTool(
      "sandbox_exec",
      { command: "python3 chart.py" },
      {
        async exec() {
          return { ok: true, stdout: "wrote /workspace/charts/plot.png\n", stderr: "", exitCode: 0 };
        },
        async writeFile() {},
        async readFile() {
          return "";
        },
        async list() {
          return [];
        },
        async exportFiles() {
          return exported.filter((file) => file.filename === "charts/plot.png");
        },
      },
    );
    assert.equal(result.ok, true);
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes(root), false);
    assert.equal(encoded.includes("/workspace"), false);
    assert.equal(encoded.includes("sandbox:"), false);
    if (result.ok) {
      const data = result.data as { stdout: string; files: Array<{ filename: string; content?: string }> };
      assert.match(data.stdout, /charts\/plot\.png/);
      assert.equal(data.files.some((file) => file.filename === "charts/plot.png"), true);
      assert.match(data.files[0]?.content ?? "", /^data:image\/png;base64,/);
    }
  });

  it("runs at most two sandbox commands at once", async () => {
    resetSandboxSlotsForTests();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aether-sandbox-cap-"));
    let active = 0;
    let maxActive = 0;
    const release: Array<() => void> = [];
    const spawnImpl: SandboxSpawn = () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const listeners: {
        close?: (code: number | null, signal: NodeJS.Signals | null) => void;
      } = {};
      release.push(() => {
        active -= 1;
        listeners.close?.(0, null);
      });
      return {
        pid: 50 + release.length,
        stdout: Readable.from([""]),
        stderr: Readable.from([""]),
        on(event, listener) {
          if (event === "close") listeners.close = listener;
        },
      };
    };
    const sandbox = createBubblewrapSandbox({
      conversationId: "conversation-1",
      userId: "guest-1",
      rootDir: root,
      mounts: [],
      spawn: spawnImpl,
    });
    const first = sandbox.exec({ command: "echo 1", timeoutMs: 5000 });
    const second = sandbox.exec({ command: "echo 2", timeoutMs: 5000 });
    const third = sandbox.exec({ command: "echo 3", timeoutMs: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(maxActive, SANDBOX_MAX_CONCURRENT);
    assert.equal(release.length, SANDBOX_MAX_CONCURRENT);
    const finish = release.shift();
    finish?.();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(release.length, SANDBOX_MAX_CONCURRENT);
    while (release.length > 0) release.shift()?.();
    const results = await Promise.all([first, second, third]);
    assert.equal(results.every((result) => result.exitCode === 0), true);
    assert.equal(maxActive, SANDBOX_MAX_CONCURRENT);
    resetSandboxSlotsForTests();
  });
});
