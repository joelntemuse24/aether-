import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAetherToolViaCallback } from "./aether-tool-callback";

describe("Aether tool callback from the durable agent", () => {
  it("posts the opaque context JWT to the existing tools route", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ ok: true, results: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const out = await executeAetherToolViaCallback({
      name: "memory_search",
      args: { query: "voice" },
      contextToken: "opaque-jwt",
      origin: "https://app.example",
      fetchImpl,
    });
    assert.equal((out as { ok: boolean }).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://app.example/api/hermes/aether-tools");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer opaque-jwt");
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.name, "memory_search");
    assert.deepEqual(body.arguments, { query: "voice" });
  });
});
