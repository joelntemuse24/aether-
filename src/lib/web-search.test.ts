import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { runWebSearch } from "./web-search";

const KEYS = ["EXA_API_KEY", "TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "FIRECRAWL_API_KEY", "AETHER_SEARCH_PROVIDER"];

describe("runWebSearch", () => {
  const previous = new Map<string, string | undefined>();

  afterEach(() => {
    for (const key of KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previous.clear();
  });

  it("reports a non-200 DuckDuckGo response instead of zero results", async () => {
    for (const key of KEYS) {
      previous.set(key, process.env[key]);
      delete process.env[key];
    }
    const original = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const href = String(input);
      if (href.includes("html.duckduckgo.com")) return new Response("bot", { status: 202 });
      if (href.includes("wikipedia.org")) return new Response("down", { status: 503 });
      if (href.includes("api.duckduckgo.com")) return new Response("bot", { status: 202 });
      return new Response("no", { status: 404 });
    };
    try {
      const output = await runWebSearch("fed funds rate");
      assert.equal(output.ok, false);
      assert.match(output.error ?? "", /HTTP 202/);
      assert.equal((output.error ?? "").includes("No search results found."), false);
    } finally {
      globalThis.fetch = original;
    }
  });
});
