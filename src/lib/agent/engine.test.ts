import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAgentEngineFlag } from "./engine";

describe("agent engine flag", () => {
  it("stays off unless the value is native, trueforge, or legacy", () => {
    assert.equal(readAgentEngineFlag({}), null);
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "" }), null);
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "yes" }), null);
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "NATIVE" }), "native");
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "trueforge" }), "trueforge");
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "legacy" }), "legacy");
  });
});
