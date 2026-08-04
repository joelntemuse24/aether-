import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  hasContinuableAssistant,
  isAbortError,
  isServerTimeoutError,
  looksLikeTimeoutCopy,
  shouldAutoContinue,
  MAX_AUTO_CONTINUES,
} from "./chat-continue";

function assistant(text: string): UIMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

describe("chat-continue", () => {
  it("detects server timeouts but not user aborts", () => {
    assert.equal(
      isServerTimeoutError(new Error("Task timed out after 300s")),
      true,
    );
    assert.equal(isAbortError(new Error("AbortError")), true);
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    assert.equal(isServerTimeoutError(abort), false);
  });

  it("recognizes timeout copy for Continue CTAs", () => {
    assert.equal(looksLikeTimeoutCopy("Server time limit hit"), true);
    assert.equal(looksLikeTimeoutCopy("Task timed out after 300s"), true);
    assert.equal(looksLikeTimeoutCopy("rate limited"), false);
  });

  it("requires assistant content before continuing", () => {
    assert.equal(hasContinuableAssistant([]), false);
    assert.equal(hasContinuableAssistant([assistant("")]), false);
    assert.equal(hasContinuableAssistant([assistant("partial…")]), true);
  });

  it("auto-continues on timeout and long disconnects", () => {
    const messages = [assistant("Working on the artifact…")];
    assert.equal(
      shouldAutoContinue({
        isAbort: false,
        isDisconnect: false,
        isError: true,
        error: new Error("Runtime Timeout"),
        messages,
        runDurationMs: 1000,
        continueCount: 0,
      }),
      true,
    );
    assert.equal(
      shouldAutoContinue({
        isAbort: false,
        isDisconnect: true,
        isError: false,
        messages,
        runDurationMs: 60_000,
        continueCount: 0,
      }),
      true,
    );
    assert.equal(
      shouldAutoContinue({
        isAbort: true,
        isDisconnect: false,
        isError: false,
        messages,
        runDurationMs: 60_000,
        continueCount: 0,
      }),
      false,
    );
    assert.equal(
      shouldAutoContinue({
        isAbort: false,
        isDisconnect: true,
        isError: false,
        messages,
        runDurationMs: 60_000,
        continueCount: MAX_AUTO_CONTINUES,
      }),
      false,
    );
  });
});
