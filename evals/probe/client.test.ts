import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { fetchHostedStatus, runLiveTurn } from "./client";
import { detectFailures } from "./detectors";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe("probe hosted client", () => {
  it("reads hosted status and falls back from head-start 503 to /api/chat", async () => {
    const seen: string[] = [];
    await withServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (req.url === "/api/hosted/status") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ available: true, chatTransport: "request" }));
        return;
      }
      if (req.url === "/api/chat/head-start") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Durable chat is not configured." }));
        return;
      }
      if (req.url === "/api/chat") {
        void readBody(req).then((body) => {
          assert.match(body, /What time is it in Dublin/);
          assert.equal(req.headers["x-access-mode"], "hosted");
          assert.equal(req.headers["x-speed-tier"], "fast");
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.write('data: {"type":"text-delta","delta":"16:10 in Dublin (Europe/Dublin)."}\n\n');
          res.write('data: {"type":"finish"}\n\n');
          res.end();
        });
        return;
      }
      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      const status = await fetchHostedStatus(baseUrl);
      assert.equal(status.available, true);
      const { snap, transport } = await runLiveTurn({
        baseUrl,
        promptId: "time-dublin",
        category: "time-dublin",
        prompt: "What time is it in Dublin, Ireland right now?",
        tier: "fast",
        timeoutMs: 5000,
        preferHeadStart: true,
      });
      assert.equal(transport, "request");
      assert.match(snap.visibleText, /Dublin/);
      assert.deepEqual(detectFailures(snap), []);
      assert.ok(seen.includes("POST /api/chat/head-start"));
      assert.ok(seen.includes("POST /api/chat"));
    });
  });

  it("records a blank stream as an empty-transcript failure", async () => {
    await withServer((req, res) => {
      if (req.url === "/api/chat") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('data: {"type":"finish"}\n\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      const { snap } = await runLiveTurn({
        baseUrl,
        promptId: "blank-survival-hello",
        category: "blank-survival",
        prompt: "Say hello",
        tier: "fast",
        timeoutMs: 2000,
        preferHeadStart: false,
      });
      assert.equal(snap.visibleText, "");
      assert.equal(detectFailures(snap).some((f) => f.code === "empty_transcript"), true);
    });
  });
});
