import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunksForTrueForgeEvent,
  closeTrueForgeUi,
  createTrueForgeUiState,
} from "./ui-chunks";

describe("TrueForge UI chunks", () => {
  it("streams assistant text the existing thread can render", () => {
    const state = createTrueForgeUiState();
    const chunks = chunksForTrueForgeEvent(
      { type: "model.message.delta", content: "Hello" },
      state,
    );
    assert.deepEqual(
      chunks.map((chunk) => chunk.type),
      ["text-start", "text-delta"],
    );
    assert.equal(chunks[1]?.delta, "Hello");
    assert.equal(closeTrueForgeUi(state).at(-1)?.type, "text-end");
  });

  it("waits for finished tool arguments and names them on the confirm card", () => {
    const state = createTrueForgeUiState();
    chunksForTrueForgeEvent(
      {
        type: "model.message.delta",
        toolCalls: [{ index: 0, id: "call_1", function: { name: "fetch_url", arguments: "{\"url\":" } }],
      },
      state,
    );
    const done = chunksForTrueForgeEvent(
      {
        type: "tool.approval_required",
        threadId: "main",
        sessionId: "ses_1",
        confirmationId: "tf_abc",
        toolCalls: [{ id: "call_1", sourceEventId: "evt" }],
      },
      state,
    );
    const confirm = done.find((chunk) => chunk.toolName === "request_confirmation");
    assert.equal((confirm?.input as { preview?: string }).preview?.includes("fetch_url"), true);
    const output = done.find(
      (chunk) =>
        (chunk.output as { confirmation_id?: string } | undefined)?.confirmation_id === "tf_abc",
    );
    assert.equal((output?.output as { needs_confirmation?: boolean }).needs_confirmation, true);
  });

  it("starts a new text part after a tool step", () => {
    const state = createTrueForgeUiState();
    chunksForTrueForgeEvent(
      { type: "model.message.delta", content: "Before", finishReason: "tool_calls" },
      state,
    );
    chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ id: "call_1", function: { name: "web_search", arguments: "{}" } }],
      },
      state,
    );
    const after = chunksForTrueForgeEvent(
      { type: "model.message.delta", content: "After" },
      state,
    );
    assert.equal(after[0]?.id, "tf-text-2");
  });
});
