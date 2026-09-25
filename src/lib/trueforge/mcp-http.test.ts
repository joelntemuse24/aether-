import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AETHER_MCP_PRELOAD, handleTrueForgeMcpRpc } from "./mcp-http";
import { readTrueForgeToolContext, signTrueForgeToolContext } from "./tool-context";
import { trueforgeInstructions } from "./instructions";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { withLocalMcpHosts } from "./outbound-hosts";

describe("TrueForge MCP tools", () => {
  it("lists web search and answers current_time without a signed context", async () => {
    const listed = await handleTrueForgeMcpRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
    const tools = (listed?.result as { tools?: { name: string }[] }).tools ?? [];
    assert.equal(tools.some((tool) => tool.name === "web_search"), true);
    assert.deepEqual(AETHER_MCP_PRELOAD.includes("web_search"), true);
    const clock = await handleTrueForgeMcpRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "current_time", arguments: { timeZone: "Europe/Dublin" } },
      },
      null,
    );
    const text = (clock?.result as { content?: { text?: string }[] }).content?.[0]?.text ?? "";
    assert.match(text, /Europe\/Dublin|iso|time/i);
  });

  it("rejects a bad tool context and accepts a fresh one", () => {
    const secret = "test-secret";
    const token = signTrueForgeToolContext(
      { approvalMode: "ask", userId: "u1", hasMemory: true },
      secret,
      1_000,
    );
    assert.equal(readTrueForgeToolContext(token, secret, 1_000)?.userId, "u1");
    assert.equal(readTrueForgeToolContext(token, secret, 1_000 + 3 * 60 * 60 * 1000), null);
    assert.equal(readTrueForgeToolContext(`${token}x`, secret, 1_000), null);
  });

  it("replaces the long tool catalog in session instructions", () => {
    const compact = trueforgeInstructions(`${TOOLS_SYSTEM_PROMPT}\n\nMemory: likes tea`);
    assert.equal(compact.includes("execute_python"), false);
    assert.match(compact, /web_search/);
    assert.match(compact, /Memory: likes tea/);
  });

  it("allowlists loopback for the sidecar MCP callback", () => {
    const hosts = JSON.parse(withLocalMcpHosts('["example.com"]')) as string[];
    assert.deepEqual(hosts, ["example.com", "127.0.0.1", "localhost"]);
  });
});
