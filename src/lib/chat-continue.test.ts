import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  hasContinuableAssistant,
  hasIncompleteToolWork,
  isAbortError,
  isServerTimeoutError,
  looksLikeTimeoutCopy,
  looksLikeUnfinishedTurn,
  shouldAutoContinue,
  shouldOfferContinue,
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

  it("treats incomplete tools as unfinished work that should auto-continue", () => {
    const messages: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            state: "input-available",
            toolCallId: "c1",
          } as UIMessage["parts"][number],
        ],
      },
    ];
    assert.equal(hasIncompleteToolWork(messages), true);
    assert.equal(looksLikeUnfinishedTurn(messages), true);
    assert.equal(
      shouldAutoContinue({
        isAbort: false,
        isDisconnect: false,
        isError: false,
        messages,
        runDurationMs: 8_000,
        continueCount: 0,
      }),
      true,
    );
  });

  it("auto-continues a clean Head Start-length abort with unfinished tools", () => {
    const messages: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Searching sources…" },
          {
            type: "tool-web_search",
            state: "input-available",
            toolCallId: "c1",
          } as UIMessage["parts"][number],
        ],
      },
    ];
    assert.equal(
      shouldAutoContinue({
        isAbort: true,
        isDisconnect: false,
        isError: false,
        messages,
        runDurationMs: 58_000,
        continueCount: 0,
      }),
      true,
    );
  });

  it("does not auto-continue a user Stop on a finished answer", () => {
    assert.equal(
      shouldAutoContinue({
        isAbort: true,
        isDisconnect: false,
        isError: false,
        messages: [assistant("Here is the finished brief.")],
        runDurationMs: 58_000,
        continueCount: 0,
      }),
      false,
    );
  });

  it("offers a Continue CTA when the budget is spent but tools are still open", () => {
    const messages: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-create_artifact",
            state: "input-available",
            toolCallId: "c1",
          } as UIMessage["parts"][number],
        ],
      },
    ];
    assert.equal(
      shouldOfferContinue({
        isAbort: false,
        isDisconnect: false,
        isError: false,
        messages,
        runDurationMs: 12_000,
        continueCount: MAX_AUTO_CONTINUES,
      }),
      true,
    );
  });

  it("does not treat a completed answer with tools as unfinished", () => {
    const messages: UIMessage[] = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            state: "output-available",
            output: { ok: true },
          } as UIMessage["parts"][number],
          { type: "text", text: "Here is the finished brief with citations." },
        ],
      },
    ];
    assert.equal(hasIncompleteToolWork(messages), false);
    assert.equal(looksLikeUnfinishedTurn(messages), false);
    assert.equal(
      shouldAutoContinue({
        isAbort: false,
        isDisconnect: false,
        isError: false,
        messages,
        runDurationMs: 90_000,
        continueCount: 0,
      }),
      false,
    );
  });
});
