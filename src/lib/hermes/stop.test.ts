import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import {
  extractHermesRunId,
  hermesRunStopUrl,
  stopHermesRun,
} from "./stop";

describe("hermes stop helpers", () => {
  it("builds POST /v1/runs/{id}/stop", () => {
    assert.equal(
      hermesRunStopUrl("https://h.example/v1/", "run_abc"),
      "https://h.example/v1/runs/run_abc/stop",
    );
  });

  it("extracts run id from response headers or JSON", () => {
    const headers = new Headers({ "x-hermes-run-id": "run_from_header" });
    assert.equal(extractHermesRunId({ headers }), "run_from_header");
    assert.equal(
      extractHermesRunId({ json: { run_id: "run_from_json" } }),
      "run_from_json",
    );
    assert.equal(extractHermesRunId({ json: { id: "chatcmpl-1" } }), null);
  });

  it("POSTs bearer-auth stop to the runs API", async () => {
    let method = "";
    let url = "";
    let auth = "";
    const server = createServer((req, res) => {
      method = req.method || "";
      url = req.url || "";
      auth = String(req.headers.authorization ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "stopping" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    try {
      await stopHermesRun({
        config: {
          baseUrl: `http://127.0.0.1:${addr.port}`,
          apiKey: "stop-key",
          modelName: "hermes-agent",
        },
        runId: "run_abc",
      });
      assert.equal(method, "POST");
      assert.equal(url, "/v1/runs/run_abc/stop");
      assert.equal(auth, "Bearer stop-key");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
