import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  configuredSearchProviders,
  firecrawlSearchPayload,
  raceFirstNonEmpty,
  TAVILY_SEARCH_DEPTH,
} from "./providers";

describe("configuredSearchProviders", () => {
  it("returns only providers with keys from env", () => {
    const list = configuredSearchProviders();
    assert.ok(Array.isArray(list));
    for (const id of list) {
      assert.ok(["brave", "exa", "tavily", "firecrawl"].includes(id));
    }
  });
});

describe("snapshot search latency", () => {
  it("uses Tavily basic search instead of advanced crawls", () => {
    assert.equal(TAVILY_SEARCH_DEPTH, "basic");
  });

  it("does not scrape full pages during Firecrawl search", () => {
    const body = firecrawlSearchPayload("Ireland unemployment rate");
    assert.equal(body.query, "Ireland unemployment rate");
    assert.equal("scrapeOptions" in body, false);
  });

  it("returns the first non-empty provider without waiting on slower ones", async () => {
    const started: string[] = [];
    const hit = await raceFirstNonEmpty(
      [
        {
          id: "slow",
          run: async (signal) => {
            started.push("slow");
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, 400);
              signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              });
            });
            return [{ title: "late" }];
          },
        },
        {
          id: "fast",
          run: async () => {
            started.push("fast");
            return [{ title: "early" }];
          },
        },
      ],
      { perTaskMs: 1_000 },
    );
    assert.ok(hit);
    assert.equal(hit.id, "fast");
    assert.deepEqual(hit.results, [{ title: "early" }]);
    assert.ok(started.includes("fast"));
    assert.ok(started.includes("slow"));
  });
});
