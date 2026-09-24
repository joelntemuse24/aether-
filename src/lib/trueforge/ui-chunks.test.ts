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
    assert.equal(closeTrueForgeUi(state)[0]?.type, "text-end");
  });

  it("emits the existing confirm-card tool when TrueForge asks for approval", () => {
    const chunks = chunksForTrueForgeEvent(
      {
        type: "tool.approval_required",
        threadId: "main",
        toolCalls: [{ id: "call_1", sourceEventId: "evt" }],
      },
      createTrueForgeUiState(),
    );
    assert.equal(chunks[0]?.toolName, "request_confirmation");
    const output = chunks[1]?.output as { needs_confirmation?: boolean; confirmation_id?: string };
    assert.equal(output.needs_confirmation, true);
    assert.equal(output.confirmation_id, "tf_call_1");
  });
});
