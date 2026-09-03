import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeAetherTool } from "./aether-tools";
import type { AetherToolContext } from "./aether-tools";

function baseCtx(over: Partial<AetherToolContext> = {}): AetherToolContext {
  return {
    userId: "user-1",
    conversationId: "c1",
    projectId: null,
    approvalMode: "ask",
    hasMemory: true,
    hasDrive: true,
    hasGitHub: true,
    ...over,
  };
}

describe("executeAetherTool", () => {
  it("runs memory_search without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "memory_search",
      args: { query: "voice" },
      ctx: baseCtx({
        deps: {
          searchMemories: async () => [{ id: "m1", title: "Voice", body: "literary" }],
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    const payload = result as unknown as { results: unknown[] };
    assert.deepEqual(payload.results, [
      { id: "m1", title: "Voice", body: "literary" },
    ]);
  });

  it("returns a confirm card for memory_write in Ask and does not write", async () => {
    let wrote = false;
    const result = await executeAetherTool({
      name: "memory_write",
      args: { title: "Voice", body: "literary" },
      ctx: baseCtx({
        approvalMode: "ask",
        deps: {
          writeMemory: async () => {
            wrote = true;
            return { id: "m1", title: "Voice", body: "literary" };
          },
          createConfirmation: async (request, userId) => {
            assert.equal(request.payload?.tool, "memory_write");
            return {
              ok: true as const,
              needs_confirmation: true as const,
              confirmation_id: "conf-1",
              action: request.action,
              title: request.title,
              preview: request.preview,
              instruction: "wait",
              userId,
            };
          },
        },
      }),
    });
    assert.equal(wrote, false);
    assert.equal(result.needs_confirmation, true);
    const gated = result as unknown as {
      confirmation_id: string;
      payload?: { tool?: string };
    };
    assert.equal(gated.confirmation_id, "conf-1");
    assert.equal(gated.payload?.tool, "memory_write");
  });

  it("creates an ordinary artifact in Ask without a confirm card", async () => {
    const result = await executeAetherTool({
      name: "create_artifact",
      args: {
        kind: "data",
        title: "Q3 costs",
        content: "item,amount\nrent,1200",
      },
      ctx: baseCtx({
        approvalMode: "ask",
        userId: null,
        deps: {
          createConfirmation: async () => {
            throw new Error("create_artifact must not pause in Ask");
          },
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    assert.equal((result as { title?: string }).title, "Q3 costs");
  });

  it("writes memory in Auto without a card", async () => {
    const result = await executeAetherTool({
      name: "memory_write",
      args: { title: "Voice", body: "literary" },
      ctx: baseCtx({
        approvalMode: "auto",
        deps: {
          writeMemory: async (userId, input) => ({
            id: "m1",
            userId,
            title: input.title,
            body: input.body,
          }),
        },
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.needs_confirmation, undefined);
    const written = result as unknown as { memory: { title: string } };
    assert.equal(written.memory.title, "Voice");
  });

  it("still confirms destructive actions in Auto", async () => {
    const result = await executeAetherTool({
      name: "request_confirmation",
      args: {
        action: "delete_resource",
        title: "Delete",
        preview: "Gone forever",
      },
      ctx: baseCtx({
        approvalMode: "auto",
        deps: {
          createConfirmation: async (request) => ({
            ok: true as const,
            needs_confirmation: true as const,
            confirmation_id: "conf-2",
            action: request.action,
            title: request.title,
            preview: request.preview,
            instruction: "wait",
          }),
        },
      }),
    });
    assert.equal(result.needs_confirmation, true);
  });

  it("keeps Drive/GitHub unavailable when the connector is off", async () => {
    const drive = await executeAetherTool({
      name: "drive_search",
      args: { query: "notes" },
      ctx: baseCtx({ hasDrive: false }),
    });
    assert.equal(drive.ok, false);
    assert.match(String((drive as { error?: string }).error), /not connected/i);

    const gh = await executeAetherTool({
      name: "github_read_file",
      args: { repo: "acme/app", path: "README.md" },
      ctx: baseCtx({ hasGitHub: false }),
    });
    assert.equal(gh.ok, false);
    assert.match(String((gh as { error?: string }).error), /not connected/i);
  });
});
