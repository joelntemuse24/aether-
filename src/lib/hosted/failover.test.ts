import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APICallError } from "@ai-sdk/provider";
import {
  HOSTED_HOP_TIMEOUT_MS,
  isFailoverError,
  withHostedHopTimeout,
} from "./failover";

function apiError(statusCode: number, body = "") {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: body,
  });
}

describe("isFailoverError", () => {
  it("fails over on 400/403/404 so Fast Ultra can reach Lightning", () => {
    assert.equal(isFailoverError(apiError(400, "model not available")), true);
    assert.equal(isFailoverError(apiError(403, "privacy policy required")), true);
    assert.equal(isFailoverError(apiError(404, "No endpoints found")), true);
  });

  it("fails over on empty-content and hop-timeout errors", () => {
    assert.equal(isFailoverError(new Error("hosted hop timeout after 8000ms")), true);
    assert.equal(isFailoverError(new Error("Empty model response")), true);
    assert.equal(isFailoverError(new Error("No content generated.")), true);
  });

  it("still fails over on 429 / 5xx", () => {
    assert.equal(isFailoverError(apiError(429)), true);
    assert.equal(isFailoverError(apiError(503)), true);
  });
});

describe("hosted hop timeout", () => {
  it("caps a hung hop so the next Cloud route can run", async () => {
    assert.ok(HOSTED_HOP_TIMEOUT_MS >= 4000);
    assert.ok(HOSTED_HOP_TIMEOUT_MS <= 12_000);
    await assert.rejects(
      () => withHostedHopTimeout(() => new Promise(() => {}), 20),
      /hosted hop timeout/i,
    );
  });
});
