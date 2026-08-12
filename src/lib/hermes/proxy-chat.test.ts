import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { proxyChatToHermes } from "./proxy-chat";
import type { HermesConfig } from "./config";

describe("proxyChatToHermes", () => {
  it("streams UIMessage SSE from a mock Hermes server", async () => {
    const server = createServer((req, res) => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/chat/completions");
      assert.match(req.headers.authorization || "", /^Bearer test-key$/);
      assert.equal(req.headers["x-hermes-session-key"], "aether:user:u1");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(
        'data: {"id":"chatcmpl-mock","choices":[{"delta":{"content":"Pong"}}]}\n\n',
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const config: HermesConfig = {
      baseUrl: `http://127.0.0.1:${addr.port}`,
      apiKey: "test-key",
      modelName: "hermes-agent",
    };

    try {
      const messages = [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "Ping" }],
        },
      ] as unknown as UIMessage[];

      const response = await proxyChatToHermes({
        messages,
        system: "Test system",
        model: "openai/gpt-4o",
        userId: "u1",
        conversationId: "c1",
        config,
      });

      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /Pong/);
      assert.match(body, /text-delta/);
      assert.match(body, /"finish"/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
