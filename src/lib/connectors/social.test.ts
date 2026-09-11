import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOCIAL_UNAVAILABLE_MESSAGE, searchSocialFeed } from "./social";

describe("social feed stub", () => {
  it("never scrapes and stays honest without an official key", async () => {
    const result = await searchSocialFeed({ query: "aether" }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error, SOCIAL_UNAVAILABLE_MESSAGE);
    assert.match(String(result.error), /official API key/i);
    assert.doesNotMatch(String(result.error), /\bX\b|Twitter|scrape/i);
  });

  it("still refuses to scrape when a key is present but no official path is wired", async () => {
    const result = await searchSocialFeed(
      { query: "aether" },
      { AETHER_SOCIAL_API_KEY: "x-key" },
    );
    assert.equal(result.ok, false);
    assert.match(String(result.error), /unavailable/i);
  });
});
