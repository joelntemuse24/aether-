import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AetherToolContext } from "@/lib/hermes/aether-tools";
import { executeTurnAccountTool } from "./account-on-vercel";
import { mintTurnToken } from "./turn-token";

const secret = "turn-secret";

describe("turn token account callback", () => {
  it("runs an allowed account tool and resolves connector tokens here", async () => {
    const token = await mintTurnToken(
      {
        sub: "user-1",
        conversationId: "c1",
        tools: ["memory_search", "drive_read"],
        approvalMode: "ask",
        requestId: "r1",
        projectId: "project-1",
      },
      secret,
    );
    assert.equal(token.includes("accessToken"), false);
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(payload.projectId, "project-1");
    assert.equal("driveAccessToken" in payload, false);
    assert.equal("githubAccessToken" in payload, false);

    let seen: AetherToolContext | null = null;
    const result = await executeTurnAccountTool({
      authorization: `Bearer ${token}`,
      secret,
      name: "memory_search",
      args: { query: "tea" },
      hasMemory: true,
      readDrive: async () => ({ accessToken: "drive-secret" }),
      readGitHub: async () => null,
      execute: async (call) => {
        seen = call.ctx;
        return { ok: true, results: [{ title: "tea" }] };
      },
    });
    assert.equal(result.kind, "ok");
    assert.equal(seen?.userId, "user-1");
    assert.equal(seen?.projectId, "project-1");
    assert.equal(seen?.driveAccessToken, "drive-secret");
    assert.equal(seen?.hasGitHub, false);
    assert.equal(JSON.stringify(result).includes("drive-secret"), false);
  });

  it("rejects a tool outside the turn allow-list and a non-account tool", async () => {
    const token = await mintTurnToken(
      {
        sub: "user-1",
        conversationId: "c1",
        tools: ["memory_search"],
        approvalMode: "ask",
        requestId: "r1",
      },
      secret,
    );
    let called = false;
    const execute = async () => {
      called = true;
      return { ok: true };
    };
    const outside = await executeTurnAccountTool({
      authorization: `Bearer ${token}`,
      secret,
      name: "drive_read",
      args: {},
      execute,
    });
    assert.equal(outside.kind, "denied");
    const merge = await executeTurnAccountTool({
      authorization: `Bearer ${token}`,
      secret,
      name: "github_merge_pull_request",
      args: {},
      execute,
    });
    assert.equal(merge.kind, "denied");
    assert.equal(called, false);
    const random = await executeTurnAccountTool({
      authorization: "Bearer nope",
      secret,
      name: "memory_search",
      args: {},
      execute,
    });
    assert.equal(random.kind, "not-turn");
  });
});
