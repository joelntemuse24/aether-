import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgentEventLog,
  sanitizeUiChunks,
  visibleTextFromEvents,
  withFinalText,
} from "./events";

describe("agent events", () => {
  it("resumes after the last event id and resyncs an unknown id", () => {
    const log = createAgentEventLog();
    log.push({ type: "text-start", id: "t" });
    const mid = log.push({ type: "text-delta", id: "t", delta: "Hi" });
    log.push({ type: "text-end", id: "t" });
    assert.deepEqual(
      log.since(mid.id).map((event) => event.chunk.type),
      ["text-end"],
    );
    assert.equal(log.since("missing").length, 3);
    assert.equal(log.since(null).length, 3);
    assert.deepEqual(log.since(log.all().at(-1)?.id), []);
  });

  it("strips leaked tool markup from text parts", () => {
    const chunks = sanitizeUiChunks([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "The weather is fine.\n<|DSML| tool_name=web_search query=\"x\">" },
      { type: "text-end", id: "t" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "web_search", input: {} },
    ]);
    const text = visibleTextFromEvents(chunks.map((chunk) => ({ chunk })));
    assert.match(text, /The weather is fine/);
    assert.equal(text.includes("DSML"), false);
    assert.equal(chunks.some((chunk) => chunk.type === "tool-input-available"), true);
  });

  it("adds a final sentence when the turn has no visible text", () => {
    const chunks = withFinalText(
      [{ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "<|DSML| tool_name=web_search>" }, { type: "text-end", id: "t" }],
      "I hit a formatting error and couldn't finish that answer. Please try again.",
    );
    const text = visibleTextFromEvents(chunks.map((chunk) => ({ chunk })));
    assert.match(text, /formatting error/);
    assert.equal(text.includes("DSML"), false);
  });
});
