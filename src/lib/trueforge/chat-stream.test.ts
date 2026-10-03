import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  FIRST_BYTE_MS,
  driveTrueForgeTurn,
  hostedTurnErrorCopy,
  isTurnActivityChunk,
  retryPreviousTurnId,
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

  it("keeps the raw provider error so a 525 still qualifies for retry", async () => {
    const writes: UiChunk[] = [];
    async function* events() {
      yield { type: "turn.done", state: { status: "error", message: "Cloudflare 525" } };
    }
    const outcome = await driveTrueForgeTurn({
      events: events(),
      write: (chunk) => writes.push(chunk),
      sessionId: "ses",
      modelId: "gpt-5.6-luna",
    });
    assert.equal(outcome.errorText, "Cloudflare 525");
    assert.equal(writes.some((chunk) => chunk.type === "error"), false);
    assert.equal(
      shouldRetryBuzzTurn({
        failedBeforeOutput: outcome.failedBeforeOutput,
        errorText: outcome.errorText,
        userAborted: false,
        attempt: 0,
      }),
      true,
    );
  });

  it("rewrites a mid-turn error for the browser and keeps the raw text", async () => {
    const writes: UiChunk[] = [];
    async function* events() {
      yield { type: "model.message.delta", content: "Partial" };
      yield { type: "turn.done", state: { status: "error", message: "Cloudflare 525" } };
    }
    const outcome = await driveTrueForgeTurn({
      events: events(),
      write: (chunk) => writes.push(chunk),
      sessionId: "ses",
      modelId: "gpt-5.6-luna",
    });
    const error = writes.find((chunk) => chunk.type === "error");
    assert.equal(outcome.errorText, "Cloudflare 525");
    assert.match(String(error?.errorText), /overloaded/);
    assert.equal(String(error?.errorText).includes("525"), false);
  });

  it("retries 502, ECONNRESET, and Cloudflare 525 from the raw turn.done error", async () => {
    for (const message of ["502 Bad Gateway", "read ECONNRESET", "Cloudflare 525"]) {
      const writes: UiChunk[] = [];
      async function* events() {
        yield { type: "turn.done", state: { status: "error", message } };
      }
      const outcome = await driveTrueForgeTurn({
        events: events(),
        write: (chunk) => writes.push(chunk),
        sessionId: "ses",
        modelId: "gpt-5.6-luna",
      });
      assert.equal(outcome.errorText, message);
      assert.equal(
        shouldRetryBuzzTurn({
          failedBeforeOutput: outcome.failedBeforeOutput,
          errorText: outcome.errorText,
          userAborted: false,
          attempt: 0,
        }),
        true,
        message,
      );
    }
    for (const message of ["model_not_found", "The model is not enabled for group"]) {
      assert.equal(
        shouldRetryBuzzTurn({
          failedBeforeOutput: true,
          errorText: message,
          userAborted: false,
          attempt: 0,
        }),
        false,
        message,
      );
    }
  });

  it("cancels the sidecar turn on Stop because a disconnect leaves it running", () => {
    assert.equal(retryPreviousTurnId(null), "auto");
    assert.equal(retryPreviousTurnId({ previousTurnId: "turn_parent" }), "turn_parent");
    assert.equal(retryPreviousTurnId({ previousTurnId: null }), "none");
    const source = readFileSync(new URL("./chat-stream.ts", import.meta.url), "utf8");
    assert.match(source, /previousTurnId: attempt === 0 \? "auto" : retryFrom/);
    assert.doesNotMatch(source, /attempt === 0 \? "auto" : "none"/);
    assert.match(source, /event\.previousTurnId \?\? event\.previous_turn_id/);
    assert.match(source, /addEventListener\("abort", onClientStop\)/);
    assert.match(source, /sessions\.cancel\(sessionId\)/);
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
    assert.match(hostedTurnErrorCopy("Request failed (522): <none>", "claude-opus-5-5"), /overloaded/);
  });

  it("maps a provider failure after a tool call to the same short wording", async () => {
    const writes: UiChunk[] = [];
    async function* events() {
      yield {
        type: "model.message",
        toolCalls: [{ id: "call_1", function: { name: "web_search", arguments: "{}" } }],
      };
      yield { type: "turn.done", state: { status: "error", message: "Request failed (522): <none>" } };
    }
    const outcome = await driveTrueForgeTurn({
      events: events(),
      write: (chunk) => writes.push(chunk),
      sessionId: "ses",
      modelId: "claude-opus-5-5",
    });
    const error = writes.find((chunk) => chunk.type === "error");
    assert.equal(outcome.failedBeforeOutput, false);
    assert.match(String(error?.errorText), /provider had an error or is overloaded/);
    assert.equal(String(error?.errorText).includes("522"), false);
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
