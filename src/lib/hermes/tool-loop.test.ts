import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import { runHermesAetherToolLoop } from "./tool-loop";
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

describe("runHermesAetherToolLoop", () => {
  it("executes a fenced Aether tool and continues the same turn", async () => {
    let turns = 0;
    const server = createServer((req, res) => {
      void (async () => {
        const body = await readJsonBody(req);
        turns += 1;
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        if (turns === 1) {
          res.write(
            'data: {"choices":[{"delta":{"content":"Looking up\\n[[aether_tool]]\\n{\\"name\\":\\"memory_search\\",\\"arguments\\":{\\"query\\":\\"voice\\"}}\\n[[/aether_tool]]\\n"}}]}\n\n',
          );
        } else {
          const msgs = body.messages as Array<{ role: string; content: string }>;
          const last = msgs[msgs.length - 1];
          assert.equal(last.role, "user");
          assert.match(last.content, /memory_search/);
          assert.match(last.content, /literary/);
          res.write(
            'data: {"choices":[{"delta":{"content":"You prefer a literary voice."}}]}\n\n',
          );
        }
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
      const response = await runHermesAetherToolLoop({
        config,
        messages: [{ role: "user", content: "What voice do I like?" }],
        model: "openai/gpt-4o",
        sessionId: "c1",
        sessionKey: "aether:user:u1",
        aether: {
          userId: "u1",
          conversationId: "c1",
          projectId: null,
          approvalMode: "ask",
          hasMemory: true,
          hasDrive: false,
          hasGitHub: false,
          deps: {
            searchMemories: async () => [
              { id: "m1", title: "Voice", body: "literary" },
            ],
          },
        },
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /Looking up/);
      assert.doesNotMatch(text, /\[\[aether_tool\]\]/);
      assert.match(text, /tool-input-start/);
      assert.match(text, /memory_search/);
      assert.match(text, /literary/);
      assert.match(text, /You prefer a literary voice/);
      assert.equal(turns, 2);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
