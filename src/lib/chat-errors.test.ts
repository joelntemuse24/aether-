import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { friendlyChatError } from "./chat-errors";

describe("friendlyChatError handover copy", () => {
  it("maps a raw handover 500 to neutral copy without vendor strings", () => {
    const copy = friendlyChatError(
      new Error("chat.handover endpoint returned 500 Internal Server Error"),
    );
    assert.equal(copy, "We couldn't start this reply right now. Click Retry — it usually works on the second try.");
    assert.doesNotMatch(copy, /chat\.|handover|endpoint|500/i);
  });
});
