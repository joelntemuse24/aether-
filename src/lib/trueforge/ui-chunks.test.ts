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
    const finished = chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ id: "call_1", function: { name: "web_search", arguments: "{}" } }],
      },
      state,
    );
    assert.equal(
      finished.some((chunk) => chunk.type === "text-end" && chunk.id === "tf-text-1"),
      true,
    );
    const after = chunksForTrueForgeEvent(
      { type: "model.message.delta", content: "After" },
      state,
    );
    assert.equal(after[0]?.id, "tf-text-2");
  });

  it("starts a fresh argument buffer when a later round reuses index 0", () => {
    const state = createTrueForgeUiState();
    chunksForTrueForgeEvent(
      {
        type: "model.message.delta",
        toolCalls: [{ index: 0, id: "call_search", function: { name: "web_search", arguments: "{\"query\":\"weather\"}" } }],
      },
      state,
    );
    chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ index: 0, id: "call_search", function: { name: "web_search", arguments: "{\"query\":\"weather\"}" } }],
      },
      state,
    );
    const second = chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ index: 0, id: "call_page", function: { name: "browse_page", arguments: "{\"url\":\"https://example.com\"}" } }],
      },
      state,
    );
    const tool = second.find((chunk) => chunk.toolCallId === "call_page");
    assert.deepEqual(tool?.input, { url: "https://example.com" });
    assert.equal(JSON.stringify(tool?.input).includes("query"), false);
  });

  it("keeps a sub-agent report in the tool step and continues the parent in a new text part", () => {
    const state = createTrueForgeUiState();
    const chunks = [
      ...chunksForTrueForgeEvent(
        { type: "model.message.delta", threadId: "main", content: "Looking it up." },
        state,
      ),
      ...chunksForTrueForgeEvent(
        {
          type: "model.message",
          threadId: "main",
          toolCalls: [
            {
              index: 0,
              id: "call_sub",
              function: { name: "create_sub_agent", arguments: "{\"task\":\"lookup\"}" },
            },
          ],
        },
        state,
      ),
      ...chunksForTrueForgeEvent(
        {
          type: "thread.created",
          threadId: "child-1",
          parent: { threadId: "main", toolCallId: "call_sub" },
        },
        state,
      ),
      ...chunksForTrueForgeEvent(
        { type: "model.message.delta", thread_id: "child-1", content: "Full repo report." },
        state,
      ),
      ...chunksForTrueForgeEvent(
        { type: "tool.response", threadId: "main", toolCallId: "call_sub", content: "" },
        state,
      ),
      ...chunksForTrueForgeEvent(
        { type: "model.message.delta", threadId: "main", content: "Cloudflare OS is not a product." },
        state,
      ),
    ];
    const text = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    assert.equal(text.includes("Full repo report"), false);
    assert.match(text, /Looking it up\./);
    assert.match(text, /Cloudflare OS is not a product\./);
    const summary = chunks.filter((chunk) => chunk.delta === "Cloudflare OS is not a product.");
    assert.equal(summary[0]?.id, "tf-text-2");
    assert.equal(
      chunks.some((chunk) => chunk.type === "text-end" && chunk.id === "tf-text-1"),
      true,
    );
    const tool = chunks.find((chunk) => chunk.toolCallId === "call_sub" && chunk.type === "tool-output-available");
    assert.equal(tool?.output, "Full repo report.");
  });

  it("opens the confirm card when a tool result is waiting for approval", () => {
    const state = createTrueForgeUiState();
    const chunks = chunksForTrueForgeEvent(
      {
        type: "tool.response",
        toolCallId: "call_1",
        content: JSON.stringify({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                needs_confirmation: true,
                confirmation_id: "conf_1",
                title: "Save memory",
                preview: "note",
              }),
            },
          ],
        }),
      },
      state,
    );
    const card = chunks.find((chunk) => chunk.toolName === "request_confirmation");
    assert.equal((card?.input as { title?: string }).title, "Save memory");
  });

  it("settles a tool that never got a response when the turn closes", () => {
    const state = createTrueForgeUiState();
    chunksForTrueForgeEvent(
      {
        type: "model.message",
        content: "Reading the page.",
        toolCalls: [{ id: "call_a", function: { name: "fetch_url", arguments: "{}" } }],
      },
      state,
    );
    assert.equal(state.openTools.size, 1);
    const closing = closeTrueForgeUi(state);
    const outputs = closing.filter((chunk) => chunk.type === "tool-output-available");
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0]?.toolCallId, "call_a");
    assert.deepEqual(outputs[0]?.output, { ok: false, error: "This step did not finish." });
    assert.equal(state.openTools.size, 0);
    assert.deepEqual(closeTrueForgeUi(state), []);
  });

  it("does not close a tool that already has a response", () => {
    const state = createTrueForgeUiState();
    chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ id: "call_b", function: { name: "fetch_url", arguments: "{}" } }],
      },
      state,
    );
    const response = chunksForTrueForgeEvent(
      { type: "tool.response", toolCallId: "call_b", content: JSON.stringify({ ok: true }) },
      state,
    );
    assert.equal(response.filter((chunk) => chunk.type === "tool-output-available").length, 1);
    assert.equal(state.openTools.size, 0);
    const closing = closeTrueForgeUi(state);
    assert.equal(closing.some((chunk) => chunk.type === "tool-output-available"), false);
  });

  it("does not re-close a tool already parked for approval", () => {
    const state = createTrueForgeUiState();
    chunksForTrueForgeEvent(
      {
        type: "model.message",
        toolCalls: [{ id: "call_c", function: { name: "exec", arguments: "{}" } }],
      },
      state,
    );
    chunksForTrueForgeEvent(
      {
        type: "tool.approval_required",
        threadId: "main",
        confirmationId: "tf_c",
        toolCalls: [{ id: "call_c" }],
      },
      state,
    );
    assert.equal(
      closeTrueForgeUi(state).some((chunk) => chunk.type === "tool-output-available"),
      false,
    );
  });
});
