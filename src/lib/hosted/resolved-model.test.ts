import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanResolvedModel,
  DEBUG_MODELS_STORAGE_KEY,
  extractResolvedModel,
  isDebugModelsEnabled,
  LAST_RESOLVED_MODEL_KEY,
  readLastResolvedModel,
  resolvedModelFromEvent,
  resolvedModelFromMessage,
  resolvedModelMetadata,
} from "./resolved-model";

describe("resolved model extractor", () => {
  it("reads x-omniroute-model from Headers and plain objects", () => {
    const headers = new Headers({ "x-omniroute-model": " apodex/apodex-1.1-mini:free " });
    assert.equal(extractResolvedModel({ headers }), "apodex/apodex-1.1-mini:free");
    assert.equal(
      extractResolvedModel({ headers: { "X-OmniRoute-Model": "a/b:free" } }),
      "a/b:free",
    );
  });

  it("prefers the header over the body model", () => {
    const headers = new Headers({ "x-omniroute-model": "a/header" });
    assert.equal(extractResolvedModel({ headers, body: { model: "b/body" } }), "a/header");
  });

  it("falls back to body.model and prefixes a bare id with the provider header", () => {
    assert.equal(extractResolvedModel({ body: { model: "x/y:free" } }), "x/y:free");
    const headers = new Headers({ "x-omniroute-provider": "apodex" });
    assert.equal(
      extractResolvedModel({ headers, body: { model: "apodex-1.1-mini:free" } }),
      "apodex/apodex-1.1-mini:free",
    );
    assert.equal(extractResolvedModel({ headers, body: { model: "q/r" } }), "q/r");
  });

  it("ignores empty values, the combo name, and non-strings", () => {
    assert.equal(extractResolvedModel({}), null);
    assert.equal(extractResolvedModel({ headers: new Headers({ "x-omniroute-model": "  " }) }), null);
    assert.equal(extractResolvedModel({ body: { model: "free-only" } }), null);
    assert.equal(extractResolvedModel({ body: { model: "omniroute/free-only" } }), null);
    assert.equal(extractResolvedModel({ body: { model: 42 } }), null);
    assert.equal(extractResolvedModel({ headers: new Headers({ "x-omniroute-provider": "p" }) }), null);
    assert.equal(extractResolvedModel({ body: "model" }), null);
  });

  it("strips control characters and caps length", () => {
    assert.equal(cleanResolvedModel("a/b\r\nSet-Cookie: x"), "a/bSet-Cookie: x");
    assert.equal(cleanResolvedModel("m".repeat(500))?.length, 200);
  });

  it("reads a model from turn events", () => {
    assert.equal(resolvedModelFromEvent({ type: "model.message", model: "a/b:free" }), "a/b:free");
    assert.equal(resolvedModelFromEvent({ type: "x", resolvedModel: "c/d" }), "c/d");
    assert.equal(
      resolvedModelFromEvent({ type: "x", headers: { "x-omniroute-model": "e/f" } }),
      "e/f",
    );
    assert.equal(resolvedModelFromEvent({ type: "model.message", content: "hi" }), null);
  });

  it("round-trips through message metadata", () => {
    const metadata = resolvedModelMetadata("a/b:free");
    assert.deepEqual(metadata, { custom: { resolvedModel: "a/b:free" } });
    assert.equal(resolvedModelFromMessage({ metadata }), "a/b:free");
    assert.equal(resolvedModelFromMessage({ metadata: { custom: {} } }), null);
    assert.equal(resolvedModelFromMessage({}), null);
    assert.equal(resolvedModelFromMessage(null), null);
  });

  it("reads the debug flag and last resolved model from storage", () => {
    const store = (values: Record<string, string>) => ({
      getItem: (key: string) => values[key] ?? null,
    });
    assert.equal(isDebugModelsEnabled(store({ [DEBUG_MODELS_STORAGE_KEY]: "1" })), true);
    assert.equal(isDebugModelsEnabled(store({ [DEBUG_MODELS_STORAGE_KEY]: "0" })), false);
    assert.equal(isDebugModelsEnabled(store({})), false);
    assert.equal(readLastResolvedModel(store({ [LAST_RESOLVED_MODEL_KEY]: "a/b" })), "a/b");
    assert.equal(readLastResolvedModel(store({})), null);
  });
});
