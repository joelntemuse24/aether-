import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { executeTurnNativeCallback } from "./native-callback";
import { mintTurnToken } from "./turn-token";

const secret = "turn-secret";

describe("native Vercel callback", () => {
  it("runs web_search from the turn allow-list and keeps a failure as ok false", async () => {
    const token = await mintTurnToken(
      {
        sub: "user-1",
        conversationId: "c1",
        tools: ["web_search", "sandbox_exec"],
        approvalMode: "ask",
        requestId: "r1",
      },
      secret,
    );
    const denied = await executeTurnNativeCallback({
      authorization: `Bearer ${token}`,
      secret,
      name: "web_search",
      args: { query: "fed" },
      search: async () => ({ ok: true, query: "fed", results: [] }),
    });
    assert.equal(denied.kind, "ok");
    const failed = await executeTurnNativeCallback({
      authorization: `Bearer ${token}`,
      secret,
      name: "web_search",
      args: { query: "fed" },
      search: async () => ({ ok: false, query: "fed", results: [], error: "No search results. (duckduckgo: HTTP 202)" }),
    });
    assert.equal(failed.kind, "ok");
    if (failed.kind === "ok") {
      assert.equal(failed.body.ok, false);
      assert.match(String(failed.body.error), /HTTP 202/);
    }
    const outsider = await mintTurnToken(
      {
        sub: "user-1",
        conversationId: "c1",
        tools: ["memory_search"],
        approvalMode: "ask",
        requestId: "r2",
      },
      secret,
    );
    const blocked = await executeTurnNativeCallback({
      authorization: `Bearer ${outsider}`,
      secret,
      name: "web_search",
      args: { query: "fed" },
      search: async () => ({ ok: true, query: "fed", results: [] }),
    });
    assert.equal(blocked.kind, "denied");
  });

  it("publishes a sandbox file for a signed-in user and a data URL for a guest", async () => {
    const dataUrl = "data:image/png;base64,aGVsbG8=";
    const signed = await mintTurnToken(
      {
        sub: "user-1",
        conversationId: "c1",
        tools: ["sandbox_exec"],
        approvalMode: "auto",
        requestId: "r3",
        canPersist: true,
      },
      secret,
    );
    let savedFor = "";
    const persisted = await executeTurnNativeCallback({
      authorization: `Bearer ${signed}`,
      secret,
      name: "publish_native_file",
      args: { filename: "charts/plot.png", mime: "image/png", dataUrl },
      cloudDb: true,
      save: async (userId) => {
        savedFor = userId;
        return {
          id: "art-1",
          kind: "file",
          title: "plot.png",
          content: dataUrl,
        };
      },
    });
    assert.equal(savedFor, "user-1");
    assert.equal(persisted.kind, "ok");
    if (persisted.kind === "ok") {
      const body = persisted.body as { downloadPath?: string; content?: string; filename?: string };
      assert.equal(body.filename, "charts/plot.png");
      assert.equal(body.downloadPath, "/api/artifacts/art-1/download");
      assert.equal(body.content, undefined);
      assert.equal(JSON.stringify(body).includes("/workspace"), false);
      assert.equal(JSON.stringify(body).includes("sandbox:"), false);
    }

    const guest = await mintTurnToken(
      {
        sub: "guest-1",
        conversationId: "c1",
        tools: ["sandbox_files"],
        approvalMode: "ask",
        requestId: "r4",
      },
      secret,
    );
    const thread = await executeTurnNativeCallback({
      authorization: `Bearer ${guest}`,
      secret,
      name: "publish_native_file",
      args: { filename: "deck.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", dataUrl },
      cloudDb: true,
      save: async () => {
        throw new Error("guests do not persist");
      },
    });
    assert.equal(thread.kind, "ok");
    if (thread.kind === "ok") {
      const body = thread.body as { content?: string; downloadPath?: string; persisted?: boolean };
      assert.equal(body.persisted, false);
      assert.equal(body.downloadPath, undefined);
      assert.equal(body.content, dataUrl);
    }

    const unsafe = await executeTurnNativeCallback({
      authorization: `Bearer ${signed}`,
      secret,
      name: "publish_native_file",
      args: { filename: "sandbox:/mnt/data/out.csv", mime: "text/csv", dataUrl },
      cloudDb: false,
    });
    assert.equal(unsafe.kind, "ok");
    if (unsafe.kind === "ok") assert.equal(unsafe.body.ok, false);
  });
});
