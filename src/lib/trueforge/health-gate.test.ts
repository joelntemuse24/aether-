import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sidecarWatchOk, watchSidecarHealth } from "./health-gate";

describe("sidecar health gate", () => {
  it("passes when the same process keeps answering", () => {
    assert.equal(
      sidecarWatchOk([
        { pid: 10, healthOk: false },
        { pid: 10, healthOk: true },
        { pid: 10, healthOk: true },
      ]),
      true,
    );
  });

  it("fails when the process restarts or never answers", () => {
    assert.equal(
      sidecarWatchOk([
        { pid: 10, healthOk: true },
        { pid: 11, healthOk: true },
      ]),
      false,
    );
    assert.equal(sidecarWatchOk([{ pid: 10, healthOk: false }]), false);
    assert.equal(sidecarWatchOk([]), false);
  });

  it("watches a fixed number of samples", async () => {
    let n = 0;
    const watched = await watchSidecarHealth({
      samples: 3,
      read: async () => ({ pid: n++ === 1 ? null : 4, healthOk: n > 1 }),
    });
    assert.equal(watched.ok, false);
    assert.equal(watched.samples.length, 3);
  });
});
