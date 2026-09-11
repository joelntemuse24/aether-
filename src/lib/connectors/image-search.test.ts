import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeImageSearchHits,
  searchImages,
  type ImageSearchHit,
} from "./image-search";

describe("search_images", () => {
  it("normalizes provider hits into carousel-ready results", () => {
    const results = normalizeImageSearchHits([
      {
        title: "Cream canvas",
        url: "https://images.example/cream.jpg",
        thumbnailUrl: "https://images.example/cream-sm.jpg",
        sourceUrl: "https://example.com/gallery",
        width: 1200,
        height: 800,
      },
      {
        title: "",
        url: "not-a-url",
      },
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.title, "Cream canvas");
    assert.equal(results[0]?.imageUrl, "https://images.example/cream.jpg");
    assert.equal(results[0]?.thumbnailUrl, "https://images.example/cream-sm.jpg");
    assert.equal(results[0]?.pageUrl, "https://example.com/gallery");
    assert.equal(results[0]?.width, 1200);
    assert.equal(results[0]?.height, 800);
  });

  it("returns usable results from an injected searcher", async () => {
    const hits: ImageSearchHit[] = [
      {
        title: "Dublin skyline",
        url: "https://cdn.example/dublin.jpg",
        thumbnailUrl: "https://cdn.example/dublin-sm.jpg",
        sourceUrl: "https://example.com/dublin",
      },
    ];
    const out = await searchImages("dublin skyline", {
      search: async (query) => {
        assert.equal(query, "dublin skyline");
        return hits;
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0]?.imageUrl, "https://cdn.example/dublin.jpg");
    assert.equal(out.carousel, true);
  });

  it("is honest when no image results are available", async () => {
    const out = await searchImages("obscure query", {
      search: async () => [],
    });
    assert.equal(out.ok, false);
    assert.match(String(out.error), /unavailable|no images/i);
    assert.deepEqual(out.results, []);
    assert.doesNotMatch(String(out.error), /Brave|Exa|Tavily|OpenRouter|Bing/i);
  });
});
