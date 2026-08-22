import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accumulateToolCallDeltas,
  consumeSseBuffer,
  contentDeltaFromChunk,
  isToolProgressDone,
  parseChatCompletionChunk,
  parsedToolCallArguments,
  toolNameFromProgress,
} from "./sse";
import { bridgeHermesChatCompletionToUIMessageResponse } from "./stream-bridge";

describe("hermes sse", () => {
  it("parses content deltas and leaves partial buffer", () => {
    const { frames, rest } = consumeSseBuffer(
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":',
    );
    assert.equal(frames.length, 1);
    const chunk = parseChatCompletionChunk(frames[0].data);
    assert.equal(contentDeltaFromChunk(chunk!), "Hi");
    assert.ok(rest.startsWith("data:"));
  });

  it("parses named hermes.tool.progress events", () => {
    const { frames } = consumeSseBuffer(
      'event: hermes.tool.progress\ndata: {"tool":"web_search","status":"started","call_id":"c1"}\n\n',
    );
    assert.equal(frames.length, 1);
    assert.equal(frames[0].event, "hermes.tool.progress");
    assert.equal(toolNameFromProgress(JSON.parse(frames[0].data)), "web_search");
    assert.equal(isToolProgressDone({ status: "completed" }), true);
  });

  it("accumulates streamed OpenAI tool_calls", () => {
    const first = accumulateToolCallDeltas([], [
      { index: 0, id: "c1", function: { name: "memory_search", arguments: '{"que' } },
    ]);
    const second = accumulateToolCallDeltas(first, [
      { index: 0, function: { arguments: 'ry":"voice"}' } },
    ]);
    assert.equal(second[0].id, "c1");
    assert.equal(second[0].name, "memory_search");
    assert.deepEqual(parsedToolCallArguments(second[0].arguments), {
      query: "voice",
    });
  });
});

describe("bridgeHermesChatCompletionToUIMessageResponse", () => {
  it("emits UIMessage SSE for text + tool progress", async () => {
    const payload =
      'event: hermes.tool.progress\ndata: {"tool":"terminal","status":"started","call_id":"t1"}\n\n' +
      'event: hermes.tool.progress\ndata: {"tool":"terminal","status":"completed","call_id":"t1","output":"ok"}\n\n' +
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
      "data: [DONE]\n\n";

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });

    const response = bridgeHermesChatCompletionToUIMessageResponse({ body });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /text-delta/);
    assert.match(text, /Hello/);
    assert.match(text, / world/);
    assert.match(text, /tool-input-start/);
    assert.match(text, /tool-output-available/);
    assert.match(text, /"finish"/);
  });
});
