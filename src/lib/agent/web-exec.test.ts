import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeWebTool } from "./web-exec";

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
});
