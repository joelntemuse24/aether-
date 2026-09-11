import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HISTORY_WAIT_BEFORE_SEND_MS,
  planClassifyBeforeSend,
  planComposerSend,
  shouldAwaitHistoryBeforeSend,
  shouldAwaitThreadInitializeBeforeSend,
} from "./chat-first-send";
import { heuristicClassify, shouldSkipModelClassify } from "./harness/heuristic";

/** Richer than pong — heuristic does not skip the model classify call. */
const RICHER_FIRST_TURN =
  "Help me think through how to organize my notes from last week into a simple system I can keep using";

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

describe("first send must not wait on classify", () => {
  it("does not await model classify on a richer first turn", () => {
    const heuristic = heuristicClassify(RICHER_FIRST_TURN);
    assert.equal(shouldSkipModelClassify(heuristic), false);
    const plan = planClassifyBeforeSend({
      isFirstTurn: true,
      heuristicSkipsModel: shouldSkipModelClassify(heuristic),
    });
    assert.equal(plan.awaitModelClassify, false);
    assert.equal(plan.skipClarifyGate, true);
  });

  it("does not hold first send for heuristic clarify cards", () => {
    const heuristic = heuristicClassify("write something");
    assert.equal(heuristic.needsClarify, true);
    const plan = planClassifyBeforeSend({
      isFirstTurn: true,
      heuristicSkipsModel: shouldSkipModelClassify(heuristic),
    });
    assert.equal(plan.awaitModelClassify, false);
    assert.equal(plan.skipClarifyGate, true);
  });

  it("still allows later turns to await model classify when heuristic does not skip", () => {
    const heuristic = heuristicClassify(RICHER_FIRST_TURN);
    const plan = planClassifyBeforeSend({
      isFirstTurn: false,
      heuristicSkipsModel: shouldSkipModelClassify(heuristic),
    });
    assert.equal(plan.awaitModelClassify, true);
    assert.equal(plan.skipClarifyGate, false);
  });

  it("keeps the shallow pong skip on later turns without a classify round-trip", () => {
    const heuristic = heuristicClassify("Reply with the single word pong");
    const plan = planClassifyBeforeSend({
      isFirstTurn: false,
      heuristicSkipsModel: shouldSkipModelClassify(heuristic),
    });
    assert.equal(plan.awaitModelClassify, false);
  });
});

describe("composer send never silent-blanks a turn", () => {
  it("blocks with a visible reason when chat is not ready", () => {
    const plan = planComposerSend({
      hasKey: false,
      canSend: false,
      hostedLoading: true,
      isRunning: false,
      classifying: false,
      hasText: true,
    });
    assert.equal(plan.action, "keep-and-explain");
    assert.equal(plan.keepComposerText, true);
    assert.match(plan.message, /ready|connecting|Preferences/i);
  });

  it("blocks with a visible reason when the runtime cannot send", () => {
    const plan = planComposerSend({
      hasKey: true,
      canSend: false,
      hostedLoading: false,
      isRunning: false,
      classifying: false,
      hasText: true,
    });
    assert.equal(plan.action, "keep-and-explain");
    assert.equal(plan.keepComposerText, true);
    assert.match(plan.message, /couldn.t send|try again|still here/i);
  });

  it("sends when the composer is ready", () => {
    const plan = planComposerSend({
      hasKey: true,
      canSend: true,
      hostedLoading: false,
      isRunning: false,
      classifying: false,
      hasText: true,
    });
    assert.equal(plan.action, "send");
  });

  it("does not start a second turn while one is already running", () => {
    const plan = planComposerSend({
      hasKey: true,
      canSend: true,
      hostedLoading: false,
      isRunning: true,
      classifying: false,
      hasText: true,
    });
    assert.equal(plan.action, "ignore");
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
    assert.doesNotMatch(thread, /await aui\.threadListItem\(\)\.initialize\(\)/);
    assert.doesNotMatch(
      thread.slice(
        thread.indexOf("const sendWithHarness"),
        thread.indexOf("const onClarifySubmit"),
      ),
      /threadListItem\(\)\.initialize\(\)/,
    );
  });

  it("does not initialize() before composer.send — remount would blank the turn", () => {
    const sendFn = thread.slice(
      thread.indexOf("const sendWithHarness"),
      thread.indexOf("const onClarifySubmit"),
    );
    const sendAt = sendFn.indexOf("composerRuntime.send()");
    assert.ok(sendAt >= 0);
    assert.doesNotMatch(sendFn, /threadListItem\(\)\.initialize\(\)/);
    assert.doesNotMatch(sendFn, /await aui\.threadListItem\(\)\.initialize\(\)/);
    assert.doesNotMatch(sendFn, /router\.(push|replace)/);
  });

  it("pins the composer on empty welcome so first send does not jump", () => {
    assert.match(thread, /aether-composer-dock/);
    assert.doesNotMatch(
      thread,
      /isEmpty \? "justify-center py-12" : "pt-2 sm:pt-4"/,
    );
  });

  it("seeds remounts from the first-send draft", () => {
    const runtime = readFileSync(
      new URL("../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    assert.match(runtime, /mergeSeedWithDraft/);
    assert.match(runtime, /shouldReplaceLiveWithStored/);
    assert.match(runtime, /do not initialize\(\) while a turn is/);
  });

  it("never silent-skips composer.send — plans a keep-and-explain path", () => {
    assert.match(thread, /planComposerSend/);
    assert.match(thread, /keep-and-explain/);
  });

  it("stashes the first-send draft before initialize can remount", () => {
    const sendFn = thread.slice(
      thread.indexOf("const sendWithHarness"),
      thread.indexOf("const onClarifySubmit"),
    );
    assert.match(sendFn, /stashFirstSendDraft/);
    const stashAt = sendFn.indexOf("stashFirstSendDraft");
    const sendAt = sendFn.indexOf("composerRuntime.send()");
    assert.ok(stashAt >= 0 && sendAt > stashAt);
    assert.doesNotMatch(sendFn, /threadListItem\(\)\.initialize\(\)/);
  });

  it("gates model classify so first send does not await /api/harness/classify", () => {
    const sendFn = thread.slice(
      thread.indexOf("const sendWithHarness"),
      thread.indexOf("const onClarifySubmit"),
    );
    assert.match(sendFn, /planClassifyBeforeSend/);
    assert.match(sendFn, /awaitModelClassify/);
    const classifyAwait = sendFn.search(
      /await fetch\(\s*["']\/api\/harness\/classify["']/,
    );
    const sendAt = sendFn.indexOf("composerRuntime.send()");
    if (classifyAwait >= 0) {
      assert.match(sendFn, /if\s*\([^)]*awaitModelClassify/);
      assert.ok(sendAt > classifyAwait);
    }
    const adapter = readFileSync(
      new URL("./local-thread-adapter.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(adapter, /\/api\/harness\/classify/);
  });
});
