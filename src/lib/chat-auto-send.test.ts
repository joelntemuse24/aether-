import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { shouldAutoSendClientTools } from "./chat-auto-send";
import { chunksForTrueForgeEvent, createTrueForgeUiState } from "./trueforge/ui-chunks";

describe("TrueForge tool turns do not auto-send", () => {
  it("marks sidecar tools provider-executed and does not re-post the turn", () => {
    const state = createTrueForgeUiState();
    const started = chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ id: "call_search", function: { name: "web_search", arguments: "{\"query\":\"weather\"}" } }],
      },
      state,
    );
    const finished = chunksForTrueForgeEvent(
      { type: "tool.response", toolCallId: "call_search", content: "{\"ok\":true}" },
      state,
    );
    const input = started.find((chunk) => chunk.type === "tool-input-available");
    const output = finished.find((chunk) => chunk.type === "tool-output-available");
    assert.equal(input?.providerExecuted, true);
    assert.equal(output?.providerExecuted, true);
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolCallId: "call_search",
            state: "output-available",
            input: { query: "weather" },
            output: { ok: true },
            providerExecuted: true,
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(lastAssistantMessageIsCompleteWithToolCalls({ messages }), false);
    assert.equal(shouldAutoSendClientTools({ messages }), false);
  });

  it("still auto-sends a browser execute_python result", () => {
    const messages = [
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-execute_python",
            toolCallId: "call_py",
            state: "output-available",
            input: { code: "print(1)" },
            output: { ok: true },
          },
        ],
      },
    ] as UIMessage[];
    assert.equal(shouldAutoSendClientTools({ messages }), true);
  });
});
