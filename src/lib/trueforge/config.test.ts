import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ageTrueforgeProbeCache,
  resetTrueforgeProbeCache,
  setTrueforgeProbeClock,
  trueforgePort,
  trueforgeSandboxEnabled,
  trueforgeSidecarEnabled,
  trueforgeSidecarReachable,
} from "./config";
import { SIDECAR_PROBE_LOCAL_TIMEOUT_MS, SIDECAR_PROBE_REMOTE_TIMEOUT_MS } from "./probe";

describe("TrueForge sidecar gate", { concurrency: 1 }, () => {
  it("stays off when AETHER_TRUEFORGE=0", async () => {
    const previous = process.env.AETHER_TRUEFORGE;
    process.env.AETHER_TRUEFORGE = "0";
    try {
      assert.equal(trueforgeSidecarEnabled(), false);
      assert.equal(await trueforgeSidecarReachable(), false);
    } finally {
      if (previous === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previous;
    }
  });

  it("does not call a remote sidecar when the shared secret is missing", async () => {
    const previousUrl = process.env.AETHER_TRUEFORGE_URL;
    const previousToken = process.env.AETHER_TRUEFORGE_TOKEN;
    const previousFlag = process.env.AETHER_TRUEFORGE;
    process.env.AETHER_TRUEFORGE_URL = "https://forge.example";
    delete process.env.AETHER_TRUEFORGE_TOKEN;
    delete process.env.AETHER_TRUEFORGE;
    try {
      assert.equal(await trueforgeSidecarReachable(200), false);
    } finally {
      if (previousUrl === undefined) delete process.env.AETHER_TRUEFORGE_URL;
      else process.env.AETHER_TRUEFORGE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.AETHER_TRUEFORGE_TOKEN;
      else process.env.AETHER_TRUEFORGE_TOKEN = previousToken;
      if (previousFlag === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previousFlag;
    }
  });

  it("treats a closed port as unreachable", async () => {
    const previousPort = process.env.TRUEFORGE_PORT;
    const previousFlag = process.env.AETHER_TRUEFORGE;
    const previousUrl = process.env.AETHER_TRUEFORGE_URL;
    process.env.TRUEFORGE_PORT = "9";
    delete process.env.AETHER_TRUEFORGE_URL;
    delete process.env.AETHER_TRUEFORGE;
    try {
      assert.equal(await trueforgeSidecarReachable(200), false);
      assert.equal(await trueforgeSandboxEnabled(200), false);
    } finally {
      if (previousPort === undefined) delete process.env.TRUEFORGE_PORT;
      else process.env.TRUEFORGE_PORT = previousPort;
      if (previousUrl === undefined) delete process.env.AETHER_TRUEFORGE_URL;
      else process.env.AETHER_TRUEFORGE_URL = previousUrl;
      if (previousFlag === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previousFlag;
    }
  });

  it("reads the port when called, and the servers read it after env load", () => {
    const previous = process.env.TRUEFORGE_PORT;
    process.env.TRUEFORGE_PORT = "9123";
    try {
      assert.equal(trueforgePort(), 9123);
      assert.equal(SIDECAR_PROBE_LOCAL_TIMEOUT_MS > 400, true);
      assert.equal(SIDECAR_PROBE_REMOTE_TIMEOUT_MS > 2_000, true);
      const vm = readFileSync(new URL("./vm-server.ts", import.meta.url), "utf8");
      const main = vm.slice(vm.indexOf("async function main"));
      assert.equal(main.indexOf("loadLocalEnvFiles()") < main.indexOf("readPort("), true);
      assert.doesNotMatch(vm, /const PUBLIC_PORT/);
      const dev = readFileSync(new URL("./dev-server.ts", import.meta.url), "utf8");
      assert.match(dev.slice(dev.indexOf("async function ensureSidecar")), /trueforgePort\(\)/);
      assert.doesNotMatch(dev, /TRUEFORGE_PORT/);
    } finally {
      if (previous === undefined) delete process.env.TRUEFORGE_PORT;
      else process.env.TRUEFORGE_PORT = previous;
    }
  });

  it("does not mark the sidecar down on a single miss", async () => {
    const previousUrl = process.env.AETHER_TRUEFORGE_URL;
    const previousToken = process.env.AETHER_TRUEFORGE_TOKEN;
    const previousFlag = process.env.AETHER_TRUEFORGE;
    const originalFetch = globalThis.fetch;
    process.env.AETHER_TRUEFORGE_URL = "https://forge.example";
    process.env.AETHER_TRUEFORGE_TOKEN = "secret";
    delete process.env.AETHER_TRUEFORGE;
    resetTrueforgeProbeCache();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("down", { status: 500 });
    };
    try {
      assert.equal(await trueforgeSidecarReachable(20), false);
      assert.equal(await trueforgeSidecarReachable(20), false);
      assert.equal(calls, 2);
      const stuck = calls;
      assert.equal(await trueforgeSidecarReachable(20), false);
      assert.equal(calls, stuck);
    } finally {
      globalThis.fetch = originalFetch;
      resetTrueforgeProbeCache();
      if (previousUrl === undefined) delete process.env.AETHER_TRUEFORGE_URL;
      else process.env.AETHER_TRUEFORGE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.AETHER_TRUEFORGE_TOKEN;
      else process.env.AETHER_TRUEFORGE_TOKEN = previousToken;
      if (previousFlag === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previousFlag;
    }
  });

  it("keeps sandbox enabled through one blip", async () => {
    const previousUrl = process.env.AETHER_TRUEFORGE_URL;
    const previousToken = process.env.AETHER_TRUEFORGE_TOKEN;
    const previousFlag = process.env.AETHER_TRUEFORGE;
    const originalFetch = globalThis.fetch;
    process.env.AETHER_TRUEFORGE_URL = "https://forge.example";
    process.env.AETHER_TRUEFORGE_TOKEN = "secret";
    delete process.env.AETHER_TRUEFORGE;
    resetTrueforgeProbeCache();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { sandbox: { enabled: true } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    try {
      assert.equal(await trueforgeSandboxEnabled(20), true);
      ageTrueforgeProbeCache(61_000);
      globalThis.fetch = async () => {
        throw new Error("blip");
      };
      assert.equal(await trueforgeSandboxEnabled(20), true);
      assert.equal(await trueforgeSandboxEnabled(20), false);
      resetTrueforgeProbeCache();
      let now = 10_000;
      setTrueforgeProbeClock(() => now);
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        throw new Error("down");
      };
      assert.equal(await trueforgeSandboxEnabled(20), false);
      assert.equal(await trueforgeSandboxEnabled(20), false);
      const cachedCalls = calls;
      assert.equal(await trueforgeSandboxEnabled(20), false);
      assert.equal(calls, cachedCalls);
      now += 3_001;
      assert.equal(await trueforgeSandboxEnabled(20), false);
      assert.equal(calls, cachedCalls + 1);
    } finally {
      globalThis.fetch = originalFetch;
      resetTrueforgeProbeCache();
      if (previousUrl === undefined) delete process.env.AETHER_TRUEFORGE_URL;
      else process.env.AETHER_TRUEFORGE_URL = previousUrl;
      if (previousToken === undefined) delete process.env.AETHER_TRUEFORGE_TOKEN;
      else process.env.AETHER_TRUEFORGE_TOKEN = previousToken;
      if (previousFlag === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previousFlag;
    }
  });
});
