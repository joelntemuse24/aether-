import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { prepareAgentHistory } from "./history";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("agent history", () => {
  it("keeps the stored prefix when the client under-sends", async () => {
    const stored: UIMessage[] = [
      { id: "1", role: "user", parts: [{ type: "text", text: "earlier question" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "earlier answer" }] },
    ];
    const incoming: UIMessage[] = [
      { id: "3", role: "user", parts: [{ type: "text", text: "follow up" }] },
    ];
    const history = await prepareAgentHistory({
      conversationId: "c1",
      incoming,
      stored,
    });
    assert.equal(history.uiMessages.length, 3);
    const encoded = JSON.stringify(history.modelMessages);
    assert.match(encoded, /earlier question/);
    assert.match(encoded, /follow up/);
  });

  it("keeps an image attachment on the model transcript", async () => {
    const incoming: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "what is in this image" },
          { type: "file", mediaType: "image/png", url: png, filename: "dot.png" },
        ],
      },
    ];
    const history = await prepareAgentHistory({ conversationId: null, incoming });
    const encoded = JSON.stringify(history.modelMessages);
    assert.match(encoded, /what is in this image/);
    assert.match(encoded, /image\/png/);
  });
});
