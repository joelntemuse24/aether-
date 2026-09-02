import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HISTORY_WAIT_BEFORE_SEND_MS,
  shouldAwaitHistoryBeforeSend,
  shouldAwaitThreadInitializeBeforeSend,
} from "./chat-first-send";
import { heuristicClassify, shouldSkipModelClassify } from "./harness/heuristic";

describe("first send must not wait on /c/ navigation", () => {
  it("does not wait for history hydrate on a new empty chat from /", () => {
    assert.equal(
      shouldAwaitHistoryBeforeSend({
        pathnameHasThread: false,
        hasRemoteId: false,
        storedCount: 0,
        historyReady: false,
      }),
      false,
    );
  });

  it("still waits when an existing thread has stored history that is not ready", () => {
    assert.equal(
      shouldAwaitHistoryBeforeSend({
        pathnameHasThread: true,
        hasRemoteId: true,
        storedCount: 3,
        historyReady: false,
      }),
      true,
    );
  });

  it("does not wait once history is already ready", () => {
    assert.equal(
      shouldAwaitHistoryBeforeSend({
        pathnameHasThread: true,
        hasRemoteId: true,
        storedCount: 3,
        historyReady: true,
      }),
      false,
    );
  });

  it("never awaits thread initialize before the first network send", () => {
    assert.equal(shouldAwaitThreadInitializeBeforeSend(), false);
  });

  it("caps any history wait well below the old 8s timeout", () => {
    assert.ok(HISTORY_WAIT_BEFORE_SEND_MS < 1000);
    assert.ok(HISTORY_WAIT_BEFORE_SEND_MS > 0);
  });

  it("skips model classify for the measured guest pong prompt", () => {
    const classification = heuristicClassify("Reply with the single word pong");
    assert.equal(shouldSkipModelClassify(classification), true);
  });
});

describe("composer send wiring", () => {
  const thread = readFileSync(
    new URL("../components/assistant-ui/thread.tsx", import.meta.url),
    "utf8",
  );

  it("gates history wait and does not unconditionally await the 8s history gate", () => {
    assert.match(thread, /shouldAwaitHistoryBeforeSend/);
    assert.doesNotMatch(thread, /await waitForChatHistoryReady\(\s*\)/);
  });

  it("does not await threadListItem initialize before composer.send", () => {
    assert.match(thread, /shouldAwaitThreadInitializeBeforeSend/);
    assert.doesNotMatch(thread, /await aui\.threadListItem\(\)\.initialize\(\)/);
  });

  it("kicks off initialize before composer.send so /c/ can update in the background", () => {
    const sendFn = thread.slice(
      thread.indexOf("const sendWithHarness"),
      thread.indexOf("const onClarifySubmit"),
    );
    const initAt = sendFn.indexOf("threadListItem().initialize()");
    const sendAt = sendFn.indexOf("composerRuntime.send()");
    assert.ok(initAt >= 0 && sendAt > initAt);
    assert.doesNotMatch(sendFn, /await aui\.threadListItem\(\)\.initialize\(\)/);
    assert.doesNotMatch(sendFn, /router\.(push|replace)/);
  });
});
