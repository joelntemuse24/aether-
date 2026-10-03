import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { AETHER_MCP_DEFERRED, AETHER_MCP_DIRECT, handleTrueForgeMcpRpc, toolResultJson, withToolDeadline } from "./mcp-http";
import {
  aetherMcpServers,
  aetherPublicOrigin,
  ensureAetherMcpServer,
  MAX_SIGNED_TOOL_TOKENS,
  needsDeferredAetherTools,
  removeAetherMcpServer,
  resetAetherMcpRegisterState,
  signedToolTokenCount,
  cachedToolContextToken,
  sealableToolContext,
} from "./mcp-register";
import {
  buildTrueForgeAgentSpec,
  evictIdleTrueForgeSessions,
  MAX_TRUEFORGE_SESSIONS,
  rememberTrueForgeSession,
  resetTrueForgeSessionCache,
  TRUEFORGE_SESSION_TTL_MS,
  trueforgeSessionCount,
  shouldSkipFailedRegistrationUpdate,
} from "./sessions";
import { sandboxEnabledFromCapabilities } from "./config";
import { connectorTokensForToolCall } from "./connector-tokens";
import { readTrueForgeToolContext, signTrueForgeToolContext } from "./tool-context";
import {
  TOOLS_UNAVAILABLE_NOTICE,
  TRUEFORGE_NO_TOOLS_NOTE,
  instructionsForRegisteredTools,
  trueforgeInstructions,
  trueforgeToolNote,
} from "./instructions";
import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";
import { withLocalMcpHosts } from "./outbound-hosts";

describe("TrueForge MCP tools", { concurrency: 1 }, () => {
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
    assert.match(compact, /Current time \(UTC\)/);
    assert.match(compact, /Europe\/Dublin/);
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
    assert.equal(on.spec.model.params?.reasoningEffort, "none");
    assert.equal(on.spec.config.sandbox.enabled, true);
    assert.equal(on.spec.config.ask_user_questions.enabled, false);
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
    const claude = buildTrueForgeAgentSpec({
      modelName: "anthropic/claude-haiku-4-5",
      instructions: "Answer.",
      mcp: null,
      sandboxEnabled: true,
    });
    assert.equal(claude.spec.model.params, undefined);
    assert.equal(claude.spec.config.ask_user_questions.enabled, false);
    const astra = buildTrueForgeAgentSpec({
      modelName: "buzz/gpt-6-astra",
      instructions: "Answer.",
      mcp: null,
      sandboxEnabled: true,
    });
    assert.equal(astra.spec.model.params?.reasoningEffort, "low");
    assert.equal(astra.spec.config.ask_user_questions.enabled, false);
  });

  it("tells every attached tool set to assume instead of asking the user to choose", () => {
    const assume = /make a reasonable assumption and state it/;
    assert.match(trueforgeToolNote(["web_search", "fetch_url", "browse_page"]), assume);
    assert.match(trueforgeToolNote(["web_search", "memory_search"]), assume);
    assert.match(TRUEFORGE_NO_TOOLS_NOTE, assume);
    assert.match(trueforgeInstructions(`${TOOLS_SYSTEM_PROMPT}\n\nMemory: likes tea`), assume);
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

  it("truncates long tool text inside valid JSON", () => {
    const text = toolResultJson({ ok: true, note: "keep", body: "x".repeat(30_000) }, 800);
    const parsed = JSON.parse(text) as { ok: boolean; note: string; body: string };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.note, "keep");
    assert.match(parsed.body, /\[truncated\]$/);
    assert.equal(text.length <= 800, true);
    assert.equal(JSON.stringify({ ok: true, body: "x".repeat(30_000) }).slice(0, 800).includes("[truncated]"), false);
  });

  it("stops a slow tool with a clean error before the route limit", async () => {
    await assert.rejects(() => withToolDeadline(new Promise(() => {}), 30), /too long/);
    const route = readFileSync(new URL("../../app/api/trueforge/mcp/route.ts", import.meta.url), "utf8");
    assert.match(route, /export const maxDuration = 300/);
    const source = readFileSync(new URL("./mcp-http.ts", import.meta.url), "utf8");
    assert.match(source, /withToolDeadline\(runTool/);
    assert.equal(source.includes(".slice(0, 24_000)"), false);
  });

  it("resolves connector tokens at call time and does not seal them", async () => {
    const tokens = await connectorTokensForToolCall({
      userId: "user-1",
      hasDrive: true,
      hasGitHub: true,
      readDrive: async () => ({ accessToken: "drive-now" }),
      readGitHub: async () => ({ accessToken: "github-now" }),
    });
    assert.deepEqual(tokens, { driveAccessToken: "drive-now", githubAccessToken: "github-now" });
    const missing = await connectorTokensForToolCall({
      userId: "user-1",
      hasDrive: true,
      hasGitHub: false,
      readDrive: async () => null,
      readGitHub: async () => ({ accessToken: "unused" }),
    });
    assert.equal(missing.driveAccessToken, undefined);
    const sealed = sealableToolContext({
      approvalMode: "ask",
      userId: "user-1",
      hasDrive: true,
      driveAccessToken: "must-not-seal",
      githubAccessToken: "must-not-seal",
    });
    assert.equal("driveAccessToken" in sealed, false);
    assert.equal("githubAccessToken" in sealed, false);
    const secret = "test-secret";
    const token = signTrueForgeToolContext(sealed, secret, 1_000);
    assert.equal(token.includes("must-not-seal"), false);
    assert.equal(readTrueForgeToolContext(token, secret, 1_000)?.driveAccessToken, undefined);
  });

  it("uses AETHER_APP_URL and refuses VERCEL_URL when that is all production has", () => {
    const previous = {
      app: process.env.AETHER_APP_URL,
      auth: process.env.AUTH_URL,
      production: process.env.VERCEL_PROJECT_PRODUCTION_URL,
      vercel: process.env.VERCEL_URL,
      nodeEnv: process.env.NODE_ENV,
    };
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    const env = process.env as Record<string, string | undefined>;
    resetAetherMcpRegisterState();
    try {
      delete process.env.AETHER_APP_URL;
      delete process.env.AUTH_URL;
      process.env.AETHER_APP_URL = "https://aether.example";
      process.env.VERCEL_URL = "aether-preview.vercel.app";
      env.NODE_ENV = "production";
      assert.equal(aetherPublicOrigin(), "https://aether.example");
      delete process.env.AETHER_APP_URL;
      delete process.env.AUTH_URL;
      assert.equal(aetherPublicOrigin(), null);
      assert.equal(aetherPublicOrigin(), null);
      assert.equal(errors.length, 1);
      assert.match(errors[0] ?? "", /AETHER_APP_URL/);
      assert.match(errors[0] ?? "", /VERCEL_URL/);
    } finally {
      console.error = originalError;
      resetAetherMcpRegisterState();
      if (previous.app === undefined) delete process.env.AETHER_APP_URL;
      else process.env.AETHER_APP_URL = previous.app;
      if (previous.auth === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = previous.auth;
      if (previous.production === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
      else process.env.VERCEL_PROJECT_PRODUCTION_URL = previous.production;
      if (previous.vercel === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = previous.vercel;
      if (previous.nodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previous.nodeEnv;
    }
  });

  it("skips a later sessions.update after registration already failed", () => {
    assert.equal(
      shouldSkipFailedRegistrationUpdate({
        existing: { toolsAttached: false, model: "buzz/gpt-5-6-luna" },
        mcpAttached: false,
        modelName: "buzz/gpt-5-6-luna",
      }),
      true,
    );
    assert.equal(
      shouldSkipFailedRegistrationUpdate({
        existing: { toolsAttached: true, model: "buzz/gpt-5-6-luna" },
        mcpAttached: false,
        modelName: "buzz/gpt-5-6-luna",
      }),
      false,
    );
    assert.equal(TOOLS_UNAVAILABLE_NOTICE, "Tools are not connected for this turn.");
    const source = readFileSync(new URL("./chat-stream.ts", import.meta.url), "utf8");
    assert.match(source, /TOOLS_UNAVAILABLE_NOTICE/);
    assert.match(source, /toolsAttached === false/);
  });

  it("does not claim tools when registration is skipped", () => {
    const withTools = trueforgeInstructions(`${TOOLS_SYSTEM_PROMPT}\n\nMemory: likes tea`);
    const without = instructionsForRegisteredTools(withTools, false);
    assert.equal(without.includes("web_search"), false);
    assert.match(without, /not connected/);
    assert.match(without, /Memory: likes tea/);
    assert.equal(instructionsForRegisteredTools(withTools, true).includes("web_search"), true);
  });

  it("caps signed tool contexts and session rows", async () => {
    resetAetherMcpRegisterState();
    resetTrueForgeSessionCache();
    const previousToken = process.env.AETHER_TRUEFORGE_TOKEN;
    const previousUrl = process.env.AETHER_TRUEFORGE_URL;
    process.env.AETHER_TRUEFORGE_TOKEN = "secret";
    process.env.AETHER_TRUEFORGE_URL = "https://forge.example";
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      return new Response(null, { status: 405 });
    };
    try {
      for (let i = 0; i < MAX_SIGNED_TOOL_TOKENS + 5; i++) {
        cachedToolContextToken(`conv-${i}`, { approvalMode: "ask" }, "secret", 1_000);
      }
      assert.equal(signedToolTokenCount() <= MAX_SIGNED_TOOL_TOKENS, true);
      for (let i = 0; i < MAX_TRUEFORGE_SESSIONS + 5; i++) {
        rememberTrueForgeSession(`conv-${i}`, { id: `ses-${i}`, model: "m", at: 1_000 + i });
      }
      assert.equal(evictIdleTrueForgeSessions(2_000).length, 5);
      assert.equal(trueforgeSessionCount(), MAX_TRUEFORGE_SESSIONS);
      rememberTrueForgeSession("stale", { id: "old", model: "m", at: 0 });
      const dropped = evictIdleTrueForgeSessions(TRUEFORGE_SESSION_TTL_MS + 1);
      assert.equal(dropped.includes("stale"), true);
      assert.equal(await removeAetherMcpServer("aether-stale"), false);
      assert.equal(calls.length, 1);
      assert.match(calls[0] ?? "", /DELETE/);
      assert.equal(await removeAetherMcpServer("aether-again"), false);
      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
      resetAetherMcpRegisterState();
      resetTrueForgeSessionCache();
      if (previousToken === undefined) delete process.env.AETHER_TRUEFORGE_TOKEN;
      else process.env.AETHER_TRUEFORGE_TOKEN = previousToken;
      if (previousUrl === undefined) delete process.env.AETHER_TRUEFORGE_URL;
      else process.env.AETHER_TRUEFORGE_URL = previousUrl;
    }
  });
});
