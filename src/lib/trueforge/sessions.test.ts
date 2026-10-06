import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUnknownModelError, retryOnUnknownModel } from "./sessions";

class SdkError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

const unknownModel = () =>
  new SdkError(
    'UnprocessableEntityError\nStatus code: 422\nBody: {"error":{"message":"Unknown model \\"omniroute/free-only\\" — not configured on provider"}}',
    422,
    { error: { message: 'Unknown model "omniroute/free-only" — not configured on provider' } },
  );

describe("isUnknownModelError", () => {
  it("matches the 422 unknown-model rejection", () => {
    assert.equal(isUnknownModelError(unknownModel()), true);
    assert.equal(
      isUnknownModelError(
        new SdkError("UnprocessableEntityError", 422, {
          error: { message: 'Unknown model "x" — not configured on provider' },
        }),
      ),
      true,
    );
  });

  it("ignores other errors", () => {
    assert.equal(isUnknownModelError(new SdkError("UnprocessableEntityError", 422, { error: { message: "bad spec" } })), false);
    assert.equal(isUnknownModelError(new SdkError('Unknown model "x" not configured', 500)), false);
    assert.equal(isUnknownModelError(new Error("fetch failed")), false);
    assert.equal(isUnknownModelError("Unknown model x not configured"), false);
    assert.equal(isUnknownModelError(null), false);
  });
});

describe("retryOnUnknownModel", () => {
  it("retries once on the unknown-model error", async () => {
    let calls = 0;
    const value = await retryOnUnknownModel(async () => {
      calls++;
      if (calls === 1) throw unknownModel();
      return "ok";
    }, 0);
    assert.equal(value, "ok");
    assert.equal(calls, 2);
  });

  it("gives up after the single retry", async () => {
    let calls = 0;
    await assert.rejects(
      retryOnUnknownModel(async () => {
        calls++;
        throw unknownModel();
      }, 0),
    );
    assert.equal(calls, 2);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    await assert.rejects(
      retryOnUnknownModel(async () => {
        calls++;
        throw new Error("boom");
      }, 0),
    );
    assert.equal(calls, 1);
  });
});
