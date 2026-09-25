import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AETHER_MCP_DEFERRED, AETHER_MCP_DIRECT, handleTrueForgeMcpRpc } from "./mcp-http";
import { aetherMcpServers, ensureAetherMcpServer, needsDeferredAetherTools } from "./mcp-register";
import { buildTrueForgeAgentSpec } from "./sessions";
import { sandboxEnabledFromCapabilities } from "./config";
import { readTrueForgeToolContext, signTrueForgeToolContext } from "./tool-context";
import { trueforgeInstructions } from "./instructions";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { withLocalMcpHosts } from "./outbound-hosts";

describe("TrueForge MCP tools", () => {
  it("lists web search and answers current_time without a signed context", async () => {
    const listed = await handleTrueForgeMcpRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null);
    const tools = (listed?.result as { tools?: { name: string }[] }).tools ?? [];
    assert.equal(tools.some((tool) => tool.name === "web_search"), true);
    assert.deepEqual(AETHER_MCP_DIRECT.includes("web_search"), true);
    const specs = aetherMcpServers({ direct: "aether-chat" });
    assert.equal(specs.length, 1);
    assert.equal(specs[0]?.preload, true);
    assert.deepEqual(specs[0]?.enableTools, ["web_search", "fetch_url", "browse_page"]);
    assert.equal(specs[0]?.enableTools.includes("current_time"), false);
    assert.equal(JSON.stringify(specs).includes("aetherx"), false);
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
    const sealed = signTrueForgeToolContext(
      { approvalMode: "ask", driveAccessToken: "drive-secret-token" },
      secret,
      1_000,
    );
    assert.equal(sealed.includes("drive-secret-token"), false);
    assert.equal(sealed.startsWith("v1."), true);
    assert.equal(readTrueForgeToolContext(sealed, secret, 1_000)?.driveAccessToken, "drive-secret-token");
    assert.equal(readTrueForgeToolContext("eyJhbGciOiJub25lIn0.payload.sig", secret, 1_000), null);
  });

  it("replaces the long tool catalog in session instructions", () => {
    const compact = trueforgeInstructions(`${TOOLS_SYSTEM_PROMPT}\n\nMemory: likes tea`);
    assert.equal(compact.includes("execute_python"), false);
    assert.match(compact, /web_search/);
    assert.match(compact, /Current time: .*UTC/);
    assert.equal(compact.includes("Use current_time for the clock"), false);
    assert.match(compact, /Memory: likes tea/);
  });

  it("keeps account tools off the session unless memory, Drive, GitHub, or a project is present", () => {
    assert.equal(needsDeferredAetherTools(null), false);
    assert.equal(needsDeferredAetherTools({}), false);
    assert.equal(needsDeferredAetherTools({ hasMemory: true }), true);
    assert.equal(needsDeferredAetherTools({ hasDrive: true }), true);
    assert.equal(needsDeferredAetherTools({ hasGitHub: true }), true);
    assert.equal(needsDeferredAetherTools({ projectId: "p1" }), true);
    const guest = aetherMcpServers({ direct: "aether-chat" }, false);
    const signedIn = aetherMcpServers({ direct: "aether-chat" }, true);
    assert.equal(guest.length, 1);
    assert.equal(signedIn.length, 1);
    assert.equal(signedIn[0]?.preload, true);
    assert.equal(signedIn[0]?.name, "aether-chat");
    for (const name of AETHER_MCP_DEFERRED) {
      assert.equal(guest[0]?.enableTools.includes(name), false);
      assert.equal(signedIn[0]?.enableTools.includes(name), true);
    }
    assert.equal(signedIn[0]?.enableTools.includes("web_search"), true);
    assert.equal(signedIn[0]?.enableTools.includes("current_time"), false);
  });

  it("enables the sandbox only when capabilities say it is ready and leaves skills unset", () => {
    assert.equal(sandboxEnabledFromCapabilities({ data: { sandbox: { enabled: true } } }), true);
    assert.equal(sandboxEnabledFromCapabilities({ data: { sandbox: { enabled: false } } }), false);
    assert.equal(sandboxEnabledFromCapabilities(null), false);
    const on = buildTrueForgeAgentSpec({
      modelName: "buzz/gpt-5-6-luna",
      instructions: "Answer.",
      mcp: { direct: "aether-chat", includeAccountTools: false },
      sandboxEnabled: true,
    });
    assert.equal(on.spec.config.sandbox.enabled, true);
    assert.equal("skills" in on.spec, false);
    assert.equal(on.spec.mcpServers?.length, 1);
    const off = buildTrueForgeAgentSpec({
      modelName: "buzz/gpt-5-6-luna",
      instructions: "Answer.",
      mcp: null,
      sandboxEnabled: false,
    });
    assert.equal(off.spec.config.sandbox.enabled, false);
    assert.equal(off.spec.mcpServers, undefined);
  });

  it("upserts one preloaded server and skips aetherx", async () => {
    const previousToken = process.env.AETHER_TRUEFORGE_TOKEN;
    const previousApp = process.env.AETHER_APP_URL;
    process.env.AETHER_TRUEFORGE_TOKEN = "test-secret";
    process.env.AETHER_APP_URL = "https://app.example";
    const names: string[] = [];
    const client = {
      settings: {
        mcpServers: {
          createOrUpdate: async (body: { manifest: { name: string } }) => {
            names.push(body.manifest.name);
          },
        },
      },
    };
    try {
      const guest = await ensureAetherMcpServer({
        client: client as never,
        conversationId: "guest1",
        context: { approvalMode: "ask" },
      });
      assert.deepEqual(names, ["aether-guest1"]);
      assert.equal(guest?.includeAccountTools, false);
      names.length = 0;
      const signedIn = await ensureAetherMcpServer({
        client: client as never,
        conversationId: "signed1",
        context: { approvalMode: "ask", hasMemory: true },
      });
      assert.deepEqual(names, ["aether-signed1"]);
      assert.equal(signedIn?.includeAccountTools, true);
      assert.equal(names.some((name) => name.startsWith("aetherx-")), false);
    } finally {
      if (previousToken === undefined) delete process.env.AETHER_TRUEFORGE_TOKEN;
      else process.env.AETHER_TRUEFORGE_TOKEN = previousToken;
      if (previousApp === undefined) delete process.env.AETHER_APP_URL;
      else process.env.AETHER_APP_URL = previousApp;
    }
  });

  it("allowlists loopback for the sidecar MCP callback", () => {
    const hosts = JSON.parse(withLocalMcpHosts('["example.com"]')) as string[];
    assert.deepEqual(hosts, ["example.com", "127.0.0.1", "localhost"]);
  });
});
