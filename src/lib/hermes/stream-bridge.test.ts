import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumeSseBuffer,
  contentDeltaFromChunk,
  isToolProgressDone,
  parseChatCompletionChunk,
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
