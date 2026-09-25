import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FIRST_BYTE_MS,
  driveTrueForgeTurn,
  hostedTurnErrorCopy,
  isTurnActivityChunk,
  shouldRetryBuzzTurn,
} from "./chat-stream";
import type { UiChunk } from "./ui-chunks";

describe("TrueForge Buzz retry", () => {
  it("retries the same model once on a transient failure before any output", () => {
    assert.equal(
      shouldRetryBuzzTurn({
        failedBeforeOutput: true,
        errorText: "Cloudflare 525",
        userAborted: false,
        attempt: 0,
      }),
      true,
    );
    assert.equal(
      shouldRetryBuzzTurn({
        failedBeforeOutput: true,
        errorText: "Cloudflare 525",
        userAborted: false,
        attempt: 1,
      }),
      false,
    );
    assert.equal(
      shouldRetryBuzzTurn({
        failedBeforeOutput: true,
        errorText: "model_not_found: not enabled for group",
        userAborted: false,
        attempt: 0,
      }),
      false,
    );
  });
});

describe("hosted turn errors", () => {
  it("names the failure instead of a generic silence", () => {
    assert.equal(FIRST_BYTE_MS, 45_000);
    assert.equal(isTurnActivityChunk({ type: "tool-output-available" }), true);
    assert.equal(isTurnActivityChunk({ type: "text-start" }), false);
    assert.match(hostedTurnErrorCopy("model_not_found", "gpt-6-astra"), /isn't available on this key/);
    assert.match(hostedTurnErrorCopy("'none' is not supported", "gpt-6-astra"), /rejected the request/);
    assert.match(hostedTurnErrorCopy("Cloudflare 525", "gpt-5.6-luna"), /overloaded/);
    assert.match(hostedTurnErrorCopy("The operation was aborted", "gpt-5.6-luna"), /timed out/);
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
