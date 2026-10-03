import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAgentEngineFlag, selectChatEngine } from "./engine";

const off = {};

describe("agent engine flag", () => {
  it("stays off unless the value is native, trueforge, or legacy", () => {
    assert.equal(readAgentEngineFlag({}), null);
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "" }), null);
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "yes" }), null);
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "NATIVE" }), "native");
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "trueforge" }), "trueforge");
    assert.equal(readAgentEngineFlag({ AETHER_AGENT_ENGINE: "legacy" }), "legacy");
  });

  it("selects the VM proxy only when the flag is native", () => {
    assert.equal(
      selectChatEngine({
        env: { AETHER_AGENT_ENGINE: "native" },
        hostedOpenRouter: true,
        trueforgeReachable: true,
        hermesLive: true,
      }),
      "native",
    );
    assert.equal(
      selectChatEngine({
        env: off,
        hostedOpenRouter: false,
        trueforgeReachable: true,
        hermesLive: true,
      }),
      "trueforge",
    );
    assert.equal(
      selectChatEngine({
        env: off,
        hostedOpenRouter: false,
        trueforgeReachable: false,
        hermesLive: false,
      }),
      "legacy",
    );
  });

  it("keeps today's order when the flag is unset or trueforge", () => {
    assert.equal(
      selectChatEngine({
        env: off,
        hostedOpenRouter: true,
        trueforgeReachable: true,
        hermesLive: true,
      }),
      "openrouter",
    );
    assert.equal(
      selectChatEngine({
        env: { AETHER_AGENT_ENGINE: "trueforge" },
        hostedOpenRouter: false,
        trueforgeReachable: true,
        hermesLive: true,
      }),
      "trueforge",
    );
    assert.equal(
      selectChatEngine({
        env: { AETHER_AGENT_ENGINE: "yes" },
        hostedOpenRouter: false,
        trueforgeReachable: false,
        hermesLive: true,
      }),
      "hermes",
    );
  });

  it("legacy skips the TrueForge sidecar", () => {
    assert.equal(
      selectChatEngine({
        env: { AETHER_AGENT_ENGINE: "legacy" },
        hostedOpenRouter: false,
        trueforgeReachable: true,
        hermesLive: true,
      }),
      "hermes",
    );
    assert.equal(
      selectChatEngine({
        env: { AETHER_AGENT_ENGINE: "legacy" },
        hostedOpenRouter: false,
        trueforgeReachable: true,
        hermesLive: false,
      }),
      "legacy",
    );
  });
});
