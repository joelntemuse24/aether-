import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trueforgeSidecarEnabled, trueforgeSidecarReachable } from "./config";

describe("TrueForge sidecar gate", () => {
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
    } finally {
      if (previousPort === undefined) delete process.env.TRUEFORGE_PORT;
      else process.env.TRUEFORGE_PORT = previousPort;
      if (previousUrl === undefined) delete process.env.AETHER_TRUEFORGE_URL;
      else process.env.AETHER_TRUEFORGE_URL = previousUrl;
      if (previousFlag === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previousFlag;
    }
  });
});
