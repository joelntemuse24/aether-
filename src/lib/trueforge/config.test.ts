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

  it("treats a closed port as unreachable", async () => {
    const previousPort = process.env.TRUEFORGE_PORT;
    const previousFlag = process.env.AETHER_TRUEFORGE;
    process.env.TRUEFORGE_PORT = "9";
    delete process.env.AETHER_TRUEFORGE;
    try {
      assert.equal(await trueforgeSidecarReachable(200), false);
    } finally {
      if (previousPort === undefined) delete process.env.TRUEFORGE_PORT;
      else process.env.TRUEFORGE_PORT = previousPort;
      if (previousFlag === undefined) delete process.env.AETHER_TRUEFORGE;
      else process.env.AETHER_TRUEFORGE = previousFlag;
    }
  });
});
