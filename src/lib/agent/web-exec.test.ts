import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeNativeTool } from "./execute-native";
import { SEARCH_UNAVAILABLE, executeWebTool } from "./web-exec";

describe("native web tools", () => {
  it("returns the clock without a network call", async () => {
    const result = await executeWebTool(
      "current_time",
      { timeZone: "UTC" },
      { now: new Date("2026-01-02T15:04:05Z") },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      const data = result.data as { timeZone?: string; utc?: string };
      assert.equal(data.timeZone, "UTC");
      assert.match(data.utc ?? "", /2026-01-02/);
    }
  });

  it("refuses a private fetch_url", async () => {
    const result = await executeWebTool("fetch_url", { url: "http://127.0.0.1/secret" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /not allowed|private|Invalid URL|Could not read/i);
      assert.equal(result.error.includes("secret"), false);
    }
  });

  it("uses the injected search and does not require a provider key", async () => {
    let query = "";
    const result = await executeWebTool(
      "web_search",
      { query: "seals" },
      {
        search: async (value) => {
          query = value;
          return { ok: true, results: [{ title: "Seals", url: "https://example.com" }] };
        },
      },
    );
    assert.equal(query, "seals");
    assert.equal(result.ok, true);
  });

  it("surfaces a failed search as an error the model can see", async () => {
    const result = await executeWebTool(
      "web_search",
      { query: "eur usd" },
      { search: async () => ({ ok: false, error: "No search results. (duckduckgo: HTTP 202)" }) },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /HTTP 202/);
  });

  it("does not scrape from the VM when search cannot call back", async () => {
    const result = await executeWebTool("web_search", { query: "eur usd" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, SEARCH_UNAVAILABLE);
  });

  it("routes web_search through the Vercel turn token", async () => {
    let auth = "";
    let body = "";
    const result = await executeNativeTool({
      name: "web_search",
      args: { query: "fed rate" },
      turnToken: "header-turn-token",
      callbackOrigin: "https://app.example",
      checkOrigin: async () => true,
      fetchImpl: async (url, init) => {
        auth = new Headers(init?.headers).get("authorization") ?? "";
        body = String(init?.body ?? "");
        assert.equal(String(url), "https://app.example/api/hermes/aether-tools");
        return new Response(
          JSON.stringify({ ok: false, error: "No search results. (duckduckgo: HTTP 202)" }),
          { status: 200 },
        );
      },
    });
    assert.equal(auth, "Bearer header-turn-token");
    assert.match(body, /"name":"web_search"/);
    assert.equal(body.includes("header-turn-token"), false);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /HTTP 202/);
  });
});
