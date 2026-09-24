import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearerMatches } from "./auth";

describe("TrueForge shared secret", () => {
  it("accepts only the exact bearer token", () => {
    assert.equal(bearerMatches("Bearer secret-1", "secret-1"), true);
    assert.equal(bearerMatches("Bearer secret-2", "secret-1"), false);
    assert.equal(bearerMatches("secret-1", "secret-1"), false);
    assert.equal(bearerMatches(undefined, "secret-1"), false);
    assert.equal(bearerMatches("Bearer secret-1", ""), false);
  });
});
