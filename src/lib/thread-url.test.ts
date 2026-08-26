import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseThreadIdFromPath,
  resolveThreadStorageKey,
  threadPath,
} from "./thread-url";

describe("thread-url", () => {
  it("round-trips a conversation id", () => {
    const id = "cf01a814-a789-4197-812a-5f468ea2f1c6";
    assert.equal(parseThreadIdFromPath(threadPath(id)), id);
    assert.equal(parseThreadIdFromPath("/"), null);
  });

  it("binds storage to remoteId, not a sibling URL", () => {
    assert.equal(
      resolveThreadStorageKey({
        status: "regular",
        remoteId: "remote-1",
        id: "local-1",
      }),
      "remote-1",
    );
    assert.equal(
      resolveThreadStorageKey({ status: "new", id: "__LOCALID_abc" }),
      undefined,
    );
    assert.equal(resolveThreadStorageKey(null), undefined);
  });
});
