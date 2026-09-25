import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pruneOldSandboxes, trueforgeSandboxDir } from "./sandbox-prune";

describe("TrueForge sandbox cleanup", () => {
  it("removes sandbox dirs older than the age limit and keeps fresh ones", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tf-sandboxes-"));
    const stale = path.join(root, "old-session");
    const fresh = path.join(root, "live-session");
    fs.mkdirSync(path.join(stale, "nested"), { recursive: true });
    fs.writeFileSync(path.join(stale, "nested", "file.txt"), "x");
    fs.mkdirSync(fresh);
    const old = new Date(Date.now() - 8 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    const removed = await pruneOldSandboxes(root, 6 * 60 * 60 * 1000);
    assert.deepEqual(removed, ["old-session"]);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.deepEqual(await pruneOldSandboxes(path.join(root, "missing")), []);
  });

  it("points at the Linux data dir TrueForge uses for the aether suffix", () => {
    if (process.platform !== "linux") return;
    const dir = trueforgeSandboxDir("aether");
    assert.match(dir, /\.local\/share\/trueforge-aether\/sandboxes$/);
  });
});
