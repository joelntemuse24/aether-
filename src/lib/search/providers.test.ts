import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configuredSearchProviders } from "./providers";

describe("configuredSearchProviders", () => {
  it("returns only providers with keys from env", () => {
    const list = configuredSearchProviders();
    assert.ok(Array.isArray(list));
    for (const id of list) {
      assert.ok(["brave", "exa", "tavily"].includes(id));
    }
  });
});
