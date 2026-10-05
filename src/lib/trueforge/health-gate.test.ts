import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pm2ReloadStable } from "./health-gate";

const script = path.join(process.cwd(), "deploy/trueforge/health-gate.sh");

describe("pm2 reload stability", () => {
  it("allows one restart from reload and then requires the same pid", () => {
    assert.equal(
      pm2ReloadStable(4, [
        { pid: 20, restartCount: 5, healthOk: false },
        { pid: 20, restartCount: 5, healthOk: true },
      ]),
      true,
    );
    assert.equal(
      pm2ReloadStable(4, [{ pid: 20, restartCount: 4, healthOk: true }]),
      true,
    );
  });

  it("rejects a second restart, a jump of more than one, or a final non-200", () => {
    assert.equal(
      pm2ReloadStable(4, [
        { pid: 20, restartCount: 5, healthOk: true },
        { pid: 21, restartCount: 6, healthOk: true },
      ]),
      false,
    );
    assert.equal(
      pm2ReloadStable(4, [{ pid: 20, restartCount: 6, healthOk: true }]),
      false,
    );
    assert.equal(
      pm2ReloadStable(4, [{ pid: 20, restartCount: 5, healthOk: false }]),
      false,
    );
  });
});

function runBash(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", args, { env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout\n${stderr}\n${stdout}`));
    }, 8000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function git(repo: string, args: string[]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")}`);
  }
}

function writeExec(file: string, body: string) {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

describe("health-gate.sh", () => {
  it("reloads only aether, skips npm ci when the lockfile is unchanged, and resets master on failure", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aether-gate-"));
    const bin = path.join(repo, "bin");
    fs.mkdirSync(bin);
    git(repo, ["init", "-b", "master"]);
    git(repo, ["config", "user.email", "gate@example.com"]);
    git(repo, ["config", "user.name", "gate"]);
    fs.writeFileSync(path.join(repo, "package-lock.json"), "{\"lock\":1}\n");
    git(repo, ["add", "package-lock.json"]);
    git(repo, ["commit", "-m", "base"]);
    const previous = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(repo, "README"), "new\n");
    git(repo, ["add", "README"]);
    git(repo, ["commit", "-m", "app"]);

    const unchanged = spawnSync("bash", [script, "--lockfile-changed", previous, "HEAD"], {
      cwd: repo,
      env: { ...process.env, AETHER_REPO_ROOT: repo },
    });
    assert.equal(unchanged.status, 1);

    fs.writeFileSync(path.join(repo, "package-lock.json"), "{\"lock\":2}\n");
    git(repo, ["add", "package-lock.json"]);
    git(repo, ["commit", "-m", "lock"]);
    const changed = spawnSync("bash", [script, "--lockfile-changed", previous, "HEAD"], {
      cwd: repo,
      env: { ...process.env, AETHER_REPO_ROOT: repo },
    });
    assert.equal(changed.status, 0);
    git(repo, ["reset", "--hard", "HEAD~1"]);

    const state = path.join(repo, "pm2.json");
    const log = path.join(repo, "pm2.log");
    const npmLog = path.join(repo, "npm.log");
    fs.writeFileSync(
      state,
      JSON.stringify([
        { name: "echomancer-takehome", pid: 3, pm2_env: { restart_time: 9 } },
        { name: "aether", pid: 10, pm2_env: { restart_time: 4 } },
      ]),
    );
    writeExec(
      path.join(bin, "pm2"),
      `#!/bin/bash
echo "$*" >> "$PM2_LOG"
if [[ "\$1" == "jlist" ]]; then
  cat "$PM2_STATE"
  exit 0
fi
if [[ "\$1" == "reload" && "\$2" == "aether" && -z "\${3:-}" ]]; then
  node -e '
    const fs = require("fs");
    const apps = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const app = apps.find((row) => row.name === "aether");
    app.pid += 1;
    app.pm2_env.restart_time += 1;
    fs.writeFileSync(process.argv[1], JSON.stringify(apps));
  ' "$PM2_STATE"
  exit 0
fi
echo "refusing pm2 \$*" >&2
exit 9
`,
    );
    writeExec(
      path.join(bin, "npm"),
      `#!/bin/bash
echo "$*" >> "$NPM_LOG"
[[ "\$1" == "ci" ]]
`,
    );

    const server = http.createServer((req, res) => {
      if (req.url === "/api/v1/capabilities") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"data":{}}');
        return;
      }
      if (req.url === "/api/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"data":[{"name":"buzz/gpt-5-6-luna"},{"name":"openrouter/qwen3-8-27b-free"}]}');
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const healthUrl = `http://127.0.0.1:${address.port}/api/v1/capabilities`;

    const run = await runBash([script, previous], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      AETHER_REPO_ROOT: repo,
      AETHER_SIDECAR_HEALTH_URL: healthUrl,
      AETHER_SIDECAR_MODELS_URL: `http://127.0.0.1:${address.port}/api/v1/models`,
      AETHER_HEALTH_GATE_SECONDS: "0",
      AETHER_HEALTH_GATE_INTERVAL: "0",
      PM2_LOG: log,
      PM2_STATE: state,
      NPM_LOG: npmLog,
    });
    server.close();
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(fs.existsSync(npmLog), false);
    const commands = fs.readFileSync(log, "utf8").trim().split("\n");
    assert.equal(commands.every((line) => line === "jlist" || line === "reload aether"), true);
    assert.equal(commands.includes("reload aether"), true);
    assert.equal(commands.some((line) => line.includes("echomancer")), false);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    assert.notEqual(head, previous);
    const branch = spawnSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    assert.equal(branch, "master");
  });

  it("resets master and reloads aether when capabilities is not 200", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aether-gate-bad-"));
    const bin = path.join(repo, "bin");
    fs.mkdirSync(bin);
    git(repo, ["init", "-b", "master"]);
    git(repo, ["config", "user.email", "gate@example.com"]);
    git(repo, ["config", "user.name", "gate"]);
    fs.writeFileSync(path.join(repo, "package-lock.json"), "{\"lock\":1}\n");
    git(repo, ["add", "package-lock.json"]);
    git(repo, ["commit", "-m", "base"]);
    const previous = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(repo, "README"), "bad\n");
    git(repo, ["add", "README"]);
    git(repo, ["commit", "-m", "bad"]);
    const state = path.join(repo, "pm2.json");
    const log = path.join(repo, "pm2.log");
    fs.writeFileSync(state, JSON.stringify([{ name: "aether", pid: 10, pm2_env: { restart_time: 1 } }]));
    writeExec(
      path.join(bin, "pm2"),
      `#!/bin/bash
echo "$*" >> "$PM2_LOG"
if [[ "\$1" == "jlist" ]]; then cat "$PM2_STATE"; exit 0; fi
if [[ "\$1" == "reload" && "\$2" == "aether" && -z "\${3:-}" ]]; then exit 0; fi
exit 9
`,
    );
    const server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end("no");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const run = await runBash([script, previous], {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      AETHER_REPO_ROOT: repo,
      AETHER_SIDECAR_HEALTH_URL: `http://127.0.0.1:${address.port}/api/v1/capabilities`,
      AETHER_HEALTH_GATE_SECONDS: "0",
      AETHER_HEALTH_GATE_INTERVAL: "0",
      PM2_LOG: log,
      PM2_STATE: state,
    });
    server.close();
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    const branch = spawnSync("git", ["branch", "--show-current"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    assert.equal(head, previous);
    assert.equal(branch, "master");
    const commands = fs.readFileSync(log, "utf8").trim().split("\n");
    assert.equal(commands.filter((line) => line === "reload aether").length, 2);
  });

  it("resets master when capabilities is 200 but the default model is not listed", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "aether-gate-model-"));
    const bin = path.join(repo, "bin");
    fs.mkdirSync(bin);
    git(repo, ["init", "-b", "master"]);
    git(repo, ["config", "user.email", "gate@example.com"]);
    git(repo, ["config", "user.name", "gate"]);
    fs.writeFileSync(path.join(repo, "package-lock.json"), "{\"lock\":1}\n");
    git(repo, ["add", "package-lock.json"]);
    git(repo, ["commit", "-m", "base"]);
    const previous = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(repo, "README"), "bad\n");
    git(repo, ["add", "README"]);
    git(repo, ["commit", "-m", "bad"]);
    const state = path.join(repo, "pm2.json");
    const log = path.join(repo, "pm2.log");
    fs.writeFileSync(state, JSON.stringify([{ name: "aether", pid: 10, pm2_env: { restart_time: 1 } }]));
    writeExec(
      path.join(bin, "pm2"),
      `#!/bin/bash
echo "$*" >> "$PM2_LOG"
if [[ "\$1" == "jlist" ]]; then cat "$PM2_STATE"; exit 0; fi
if [[ "\$1" == "reload" && "\$2" == "aether" && -z "\${3:-}" ]]; then exit 0; fi
exit 9
`,
    );
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(req.url === "/api/v1/models" ? '{"data":[{"name":"buzz/gpt-5-6-luna"}]}' : '{"data":{}}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      AETHER_REPO_ROOT: repo,
      AETHER_SIDECAR_HEALTH_URL: `${base}/capabilities`,
      AETHER_SIDECAR_MODELS_URL: `${base}/models`,
      AETHER_HEALTH_GATE_SECONDS: "0",
      AETHER_HEALTH_GATE_INTERVAL: "0",
      PM2_LOG: log,
      PM2_STATE: state,
    };
    const run = await runBash([script, previous], env);
    assert.equal(run.status, 1, run.stderr || run.stdout);
    assert.match(run.stderr, /does not list openrouter\/qwen3-8-27b-free/);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
    assert.equal(head, previous);

    git(repo, ["reset", "--hard", "HEAD@{1}"]);
    const skipped = await runBash([script, previous], { ...env, AETHER_SIDECAR_REQUIRED_MODEL: "" });
    server.close();
    assert.equal(skipped.status, 0, skipped.stderr || skipped.stdout);
  });
});
