import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aetherToolsCallbackSecret,
  authorizeAetherToolsCallback,
} from "./callback-auth";

describe("Aether tools callback auth", () => {
  it("prefers AETHER_TOOLS_TOKEN then the hosted gateway key", () => {
    assert.equal(
      aetherToolsCallbackSecret({
        AETHER_TOOLS_TOKEN: "tool-secret",
        HERMES_API_KEY: "gateway-secret",
      }),
      "tool-secret",
    );
    assert.equal(
      aetherToolsCallbackSecret({ HERMES_API_KEY: "gateway-secret" }),
      "gateway-secret",
    );
    assert.equal(aetherToolsCallbackSecret({}), null);
  });

  it("accepts a matching bearer token", () => {
    const ok = authorizeAetherToolsCallback(
      { authorization: "Bearer tool-secret" },
      { AETHER_TOOLS_TOKEN: "tool-secret" },
    );
    assert.equal(ok, true);
  });

  it("rejects missing or wrong tokens", () => {
    assert.equal(
      authorizeAetherToolsCallback(
        { authorization: "Bearer nope" },
        { AETHER_TOOLS_TOKEN: "tool-secret" },
      ),
      false,
    );
    assert.equal(
      authorizeAetherToolsCallback({}, { AETHER_TOOLS_TOKEN: "tool-secret" }),
      false,
    );
    assert.equal(authorizeAetherToolsCallback({ authorization: "Bearer x" }, {}), false);
  });
});
