import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinishReason, ModelMessage } from "ai";
import {
  finishReasonAfterHeadStartAbort,
  isHeadStartAbort,
  modelMessagesHaveAssistantContent,
  modelMessagesNeedToolHandover,
  wrapHeadStartStreamResult,
} from "./head-start-handover";

function assistantTools(): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "web_search",
          input: { query: "keep going" },
        },
      ],
    },
  ];
}

describe("head-start handover on abort", () => {
  it("treats SDK idle timeout and AbortError as Head Start aborts", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    assert.equal(isHeadStartAbort(abort), true);
    assert.equal(
      isHeadStartAbort(new Error("chat.handover: idle timeout")),
      true,
    );
    assert.equal(isHeadStartAbort(new Error("rate limited")), false);
  });

  it("detects pending tool-calls on the step-1 assistant", () => {
    assert.equal(modelMessagesNeedToolHandover(assistantTools()), true);
    assert.equal(
      modelMessagesNeedToolHandover([
        { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      ]),
      false,
    );
    assert.equal(modelMessagesHaveAssistantContent(assistantTools()), false);
    assert.equal(
      modelMessagesHaveAssistantContent([
        { role: "assistant", content: [{ type: "text", text: "Partial" }] },
      ]),
      true,
    );
  });

  it("hands tool-calls and empty thinking aborts to the parked agent", () => {
    assert.equal(finishReasonAfterHeadStartAbort(assistantTools()), "tool-calls");
    assert.equal(finishReasonAfterHeadStartAbort([]), "tool-calls");
    assert.equal(
      finishReasonAfterHeadStartAbort([
        { role: "assistant", content: [{ type: "text", text: "Draft…" }] },
      ]),
      "stop",
    );
  });

  it("wraps a rejected finishReason into handover instead of skip", async () => {
    const abort = new Error("chat.handover: idle timeout");
    abort.name = "AbortError";
    const result = wrapHeadStartStreamResult({
      finishReason: Promise.reject(abort) as Promise<FinishReason>,
      response: Promise.resolve({ messages: assistantTools() }),
      toUIMessageStream() {
        return "ok";
      },
    });
    assert.equal(await result.finishReason, "tool-calls");
    assert.equal(result.toUIMessageStream(), "ok");
  });

  it("does not swallow a real model error as handover", async () => {
    const result = wrapHeadStartStreamResult({
      finishReason: Promise.reject(new Error("provider 500")) as Promise<FinishReason>,
      response: Promise.resolve({ messages: [] }),
    });
    await assert.rejects(() => Promise.resolve(result.finishReason), /provider 500/);
  });
});
