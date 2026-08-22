import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { proxyChatToHermes } from "./proxy-chat";
import type { HermesConfig } from "./config";

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

describe("proxyChatToHermes", () => {
  it("maps messages, session headers, bearer auth, and provider", async () => {
    let seen: {
      method?: string;
      url?: string;
      authorization?: string;
      sessionKey?: string;
      sessionId?: string;
      idempotency?: string;
      body?: Record<string, unknown>;
    } = {};

    const server = createServer((req, res) => {
      void (async () => {
        seen = {
          method: req.method,
          url: req.url,
          authorization: String(req.headers.authorization ?? ""),
          sessionKey: String(req.headers["x-hermes-session-key"] ?? ""),
          sessionId: String(req.headers["x-hermes-session-id"] ?? ""),
          idempotency: String(req.headers["idempotency-key"] ?? ""),
          body: await readJsonBody(req),
        };
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
      })();
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
        runId: "run-aether-1",
        accessMode: "hosted",
        config,
      });

      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /Pong/);
      assert.match(body, /text-delta/);
      assert.match(body, /"finish"/);

      assert.equal(seen.method, "POST");
      assert.equal(seen.url, "/v1/chat/completions");
      assert.equal(seen.authorization, "Bearer test-key");
      assert.equal(seen.sessionKey, "aether:user:u1");
      assert.equal(seen.sessionId, "c1");
      assert.equal(seen.idempotency, "run-aether-1");
      assert.equal(seen.body?.model, "openai/gpt-4o");
      assert.equal(seen.body?.provider, "openrouter");
      assert.equal(seen.body?.stream, true);
      const msgs = seen.body?.messages as Array<{ role: string; content: string }>;
      assert.equal(msgs[0].role, "system");
      assert.equal(msgs[0].content, "Test system");
      assert.equal(msgs[1].role, "user");
      assert.equal(msgs[1].content, "Ping");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
