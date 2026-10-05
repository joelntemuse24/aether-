import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AETHER_MCP_DEFERRED } from "./mcp-http";
import {
  AETHER_MCP_SLOT_IDLE_TTL_MS,
  aetherMcpServerNames,
  aetherMcpServers,
  aetherMcpSlotLeaseCount,
  ensureAetherMcpServer,
  leasedAetherMcpSlotName,
  MAX_AETHER_MCP_SLOTS,
  needsDeferredAetherTools,
  releaseAetherMcpSlot,
  removeAetherMcpServer,
  resetAetherMcpRegisterState,
} from "./mcp-register";

const SLOT_NAME = /^aether-s\d{2}$/;

describe("aether MCP slot pool", () => {
  beforeEach(() => resetAetherMcpRegisterState());
  afterEach(() => resetAetherMcpRegisterState());

  it("uses short slot names and keeps a conversation on one slot", () => {
    const first = aetherMcpServerNames("conv-abc-123", 1_000);
    assert.match(first.direct, SLOT_NAME);
    assert.equal(first.deferred, first.direct.replace("aether-", "aetherx-"));
    assert.equal(first.direct.includes("conv"), false);
    assert.deepEqual(aetherMcpServerNames("conv-abc-123", 2_000), first);
    assert.equal(aetherMcpSlotLeaseCount(), 1);
  });

  it("gives concurrent conversations different slots", () => {
    const seen = new Set<string>();
    for (let i = 0; i < MAX_AETHER_MCP_SLOTS; i++) {
      seen.add(aetherMcpServerNames(`conv-${i}`, 1_000).direct);
    }
    assert.equal(seen.size, MAX_AETHER_MCP_SLOTS);
  });

  it("caps distinct names at the pool size", () => {
    const seen = new Set<string>();
    for (let i = 0; i < MAX_AETHER_MCP_SLOTS * 4; i++) {
      seen.add(aetherMcpServerNames(`conv-${i}`, 1_000 + i).direct);
    }
    assert.equal(seen.size, MAX_AETHER_MCP_SLOTS);
    assert.equal(aetherMcpSlotLeaseCount() <= MAX_AETHER_MCP_SLOTS, true);
  });

  it("hands an expired lease to the next conversation", () => {
    for (let i = 0; i < MAX_AETHER_MCP_SLOTS; i++) aetherMcpServerNames(`conv-${i}`, 0);
    const stale = leasedAetherMcpSlotName("conv-0");
    assert.ok(stale);
    // Keep every other lease fresh; only conv-0 is idle past the TTL.
    const now = AETHER_MCP_SLOT_IDLE_TTL_MS + 1;
    for (let i = 1; i < MAX_AETHER_MCP_SLOTS; i++) aetherMcpServerNames(`conv-${i}`, now);
    const next = aetherMcpServerNames("newcomer", now).direct;
    assert.equal(next, stale);
    assert.equal(leasedAetherMcpSlotName("conv-0"), null);
    assert.equal(aetherMcpSlotLeaseCount(), MAX_AETHER_MCP_SLOTS);
  });

  it("reclaims the oldest lease when every lease is live", () => {
    for (let i = 0; i < MAX_AETHER_MCP_SLOTS; i++) aetherMcpServerNames(`conv-${i}`, 1_000 + i);
    const oldestSlot = leasedAetherMcpSlotName("conv-0");
    const next = aetherMcpServerNames("newcomer", 2_000).direct;
    assert.equal(next, oldestSlot);
    assert.equal(leasedAetherMcpSlotName("conv-0"), null);
    assert.equal(leasedAetherMcpSlotName("conv-1") !== null, true);
  });

  it("releases a lease and returns its name once", () => {
    const { direct } = aetherMcpServerNames("conv-x", 1_000);
    assert.equal(releaseAetherMcpSlot("conv-x"), direct);
    assert.equal(releaseAetherMcpSlot("conv-x"), null);
    assert.equal(aetherMcpSlotLeaseCount(), 0);
  });
});

describe("deferred account tools", () => {
  it("is true for memory, Drive, GitHub, or a project and false for guests", () => {
    assert.equal(needsDeferredAetherTools({ hasMemory: true }), true);
    assert.equal(needsDeferredAetherTools({ hasDrive: true }), true);
    assert.equal(needsDeferredAetherTools({ hasGitHub: true }), true);
    assert.equal(needsDeferredAetherTools({ projectId: "p1" }), true);
    assert.equal(needsDeferredAetherTools({}), false);
    assert.equal(needsDeferredAetherTools(null), false);
  });

  it("attaches deferred tools through a pooled slot even when DELETE is unsupported", async () => {
    resetAetherMcpRegisterState();
    const previousToken = process.env.AETHER_TRUEFORGE_TOKEN;
    const previousApp = process.env.AETHER_APP_URL;
    const previousKey = process.env.AETHER_TOOL_CONTEXT_KEY;
    process.env.AETHER_TRUEFORGE_TOKEN = "test-transport";
    process.env.AETHER_APP_URL = "https://app.example";
    process.env.AETHER_TOOL_CONTEXT_KEY = "test-context-key-for-pool";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 405 });
    await removeAetherMcpServer("aether-gone");
    const upserts: string[] = [];
    const client = {
      settings: {
        mcpServers: {
          createOrUpdate: async (body: { manifest: { name: string } }) => {
            upserts.push(body.manifest.name);
          },
        },
      },
    };
    try {
      for (const context of [
        { approvalMode: "ask" as const, hasDrive: true },
        { approvalMode: "ask" as const, hasGitHub: true },
        { approvalMode: "ask" as const, hasMemory: true },
        { approvalMode: "ask" as const, projectId: "p1" },
      ]) {
        const attached = await ensureAetherMcpServer({
          client: client as never,
          conversationId: `signed-${upserts.length}`,
          context,
        });
        assert.ok(attached);
        assert.match(attached.direct, SLOT_NAME);
        assert.equal(attached.includeAccountTools, true);
        const tools = aetherMcpServers({ direct: attached.direct }, attached.includeAccountTools)[0]?.enableTools ?? [];
        for (const tool of AETHER_MCP_DEFERRED) assert.equal(tools.includes(tool), true);
      }
      const guest = await ensureAetherMcpServer({
        client: client as never,
        conversationId: "guest",
        context: { approvalMode: "ask" },
      });
      assert.equal(guest?.includeAccountTools, false);
      const guestTools = aetherMcpServers({ direct: guest?.direct ?? "" }, false)[0]?.enableTools ?? [];
      for (const tool of AETHER_MCP_DEFERRED) assert.equal(guestTools.includes(tool), false);
      assert.equal(upserts.every((name) => SLOT_NAME.test(name)), true);
    } finally {
      globalThis.fetch = originalFetch;
      resetAetherMcpRegisterState();
      for (const [key, value] of [
        ["AETHER_TRUEFORGE_TOKEN", previousToken],
        ["AETHER_APP_URL", previousApp],
        ["AETHER_TOOL_CONTEXT_KEY", previousKey],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
