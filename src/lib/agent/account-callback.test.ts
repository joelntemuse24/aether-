import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACCOUNT_TOOL_UNAVAILABLE, executeAccountCallback } from "./account-callback";

describe("native account callback", () => {
  it("does not call a loopback origin", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("nope");
    };
    const result = await executeAccountCallback({
      name: "memory_search",
      args: { query: "tea" },
      turnToken: "turn-token",
      origin: "http://127.0.0.1:3000",
      fetchImpl,
    });
    assert.equal(called, false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, ACCOUNT_TOOL_UNAVAILABLE);
  });

  it("sends the turn token as the bearer and not in the body", async () => {
    let auth = "";
    let body = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      auth = new Headers(init?.headers).get("authorization") ?? "";
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 });
    };
    const result = await executeAccountCallback({
      name: "memory_search",
      args: { query: "tea" },
      turnToken: "header-turn-token",
      origin: "https://app.example",
      fetchImpl,
      checkOrigin: async () => true,
    });
    assert.equal(result.ok, true);
    assert.equal(auth, "Bearer header-turn-token");
    assert.match(body, /memory_search/);
    assert.equal(body.includes("header-turn-token"), false);
    assert.equal(body.includes("accessToken"), false);
    assert.equal(new Headers().get("cookie"), null);
  });
});
