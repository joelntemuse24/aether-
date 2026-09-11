import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optionalMcpStatus } from "./optional";

describe("optional MCP hook", () => {
  it("is off by default and does not claim a marketplace", () => {
    const status = optionalMcpStatus({});
    assert.equal(status.enabled, false);
    assert.equal(status.available, false);
    assert.match(status.reason, /off|not included|marketplace/i);
    assert.doesNotMatch(status.reason, /Anthropic|Claude|vendor/i);
  });

  it("reports a configured hook without connecting a marketplace", () => {
    const status = optionalMcpStatus({
      AETHER_MCP_ENABLED: "1",
      AETHER_MCP_URL: "https://mcp.example/sse",
    });
    assert.equal(status.enabled, true);
    assert.equal(status.available, true);
    assert.equal(status.url, "https://mcp.example/sse");
  });
});
