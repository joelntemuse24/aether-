import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { driveTrueForgeTurn, shouldFailoverTrueForgeTurn } from "./chat-stream";
import type { UiChunk } from "./ui-chunks";

describe("TrueForge model failover", () => {
  it("retries OpenRouter only when the primary failed before any output", () => {
    assert.equal(
      shouldFailoverTrueForgeTurn({
        failedBeforeOutput: true,
        fallback: "openrouter/gpt-5-6-luna",
        usedFallback: false,
      }),
      true,
    );
    assert.equal(
      shouldFailoverTrueForgeTurn({
        failedBeforeOutput: false,
        fallback: "openrouter/gpt-5-6-luna",
        usedFallback: false,
      }),
      false,
    );
    assert.equal(
      shouldFailoverTrueForgeTurn({
        failedBeforeOutput: true,
        fallback: null,
        usedFallback: false,
      }),
      false,
    );
  });
});

describe("TrueForge live stream", () => {
  it("writes a text delta before the next event is pulled", async () => {
    const writes: UiChunk[] = [];
    let wroteBeforeResume = false;
    async function* events() {
      yield { type: "model.message.delta", content: "Hi" };
      wroteBeforeResume = writes.some((chunk) => chunk.type === "text-delta");
      yield { type: "turn.done", state: { status: "completed" } };
    }
    const outcome = await driveTrueForgeTurn({
      events: events(),
      write: (chunk) => writes.push(chunk),
      sessionId: "ses",
    });
    assert.equal(wroteBeforeResume, true);
    assert.equal(outcome.failedBeforeOutput, false);
    assert.equal(writes[0]?.type, "text-start");
  });

  it("holds a failure that happens before any content", async () => {
    const writes: UiChunk[] = [];
    async function* events() {
      yield { type: "turn.done", state: { status: "error", message: "boom" } };
    }
    const outcome = await driveTrueForgeTurn({
      events: events(),
      write: (chunk) => writes.push(chunk),
      sessionId: "ses",
    });
    assert.equal(outcome.failedBeforeOutput, true);
    assert.equal(writes.some((chunk) => chunk.type === "error"), false);
  });

  it("surfaces an error after text has started and does not repeat it", async () => {
    const writes: UiChunk[] = [];
    async function* events() {
      yield { type: "model.message.delta", content: "Partial" };
      yield { type: "turn.done", state: { status: "error", message: "cut" } };
    }
    const outcome = await driveTrueForgeTurn({
      events: events(),
      write: (chunk) => writes.push(chunk),
      sessionId: "ses",
    });
    assert.equal(outcome.failedBeforeOutput, false);
    assert.equal(outcome.wroteError, true);
    assert.equal(writes.filter((chunk) => chunk.type === "text-delta").length, 1);
  });
});
