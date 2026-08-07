import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configuredSearchProviders } from "./providers";

describe("configuredSearchProviders", () => {
  it("returns only providers with keys from env", () => {
    const list = configuredSearchProviders();
    assert.ok(Array.isArray(list));
    for (const id of list) {
      assert.ok(["firecrawl", "brave", "exa", "tavily"].includes(id));
    }
  });

  it("lists firecrawl first when that key is present among others", () => {
    const prevF = process.env.FIRECRAWL_API_KEY;
    const prevB = process.env.BRAVE_SEARCH_API_KEY;
    const prevP = process.env.AETHER_SEARCH_PROVIDER;
    try {
      process.env.FIRECRAWL_API_KEY = "fc-test";
      process.env.BRAVE_SEARCH_API_KEY = "brave-test";
      delete process.env.AETHER_SEARCH_PROVIDER;
      const list = configuredSearchProviders();
      assert.equal(list[0], "firecrawl");
      assert.ok(list.includes("brave"));
    } finally {
      if (prevF === undefined) delete process.env.FIRECRAWL_API_KEY;
      else process.env.FIRECRAWL_API_KEY = prevF;
      if (prevB === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
      else process.env.BRAVE_SEARCH_API_KEY = prevB;
      if (prevP === undefined) delete process.env.AETHER_SEARCH_PROVIDER;
      else process.env.AETHER_SEARCH_PROVIDER = prevP;
    }
  });
});
