import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { scriptedMockModel } from "@/lib/agent/mock-provider";
import { visibleTextFromEvents } from "@/lib/agent/events";
import type { AgentTurnRequest } from "./handler";
import { attachNativeTools, runNativeTurn } from "./run-turn";

describe("runNativeTurn", () => {
  it("logs the native engine and does not log the per-turn key", async () => {
    const lines: unknown[][] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args);
    };
    const body: AgentTurnRequest = {
      modelId: "gpt-5.6-luna",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] }] as UIMessage[],
      system: "Be brief.",
      conversationId: "c1",
      userId: "user-1",
      approvalMode: "ask",
      tools: [],
      depth: "standard",
      timeMinutes: null,
      timeZone: null,
      openRouterKey: "sk-or-secret",
      turnToken: "turn-token",
      callbackOrigin: null,
    };
    try {
      const events = await runNativeTurn(body, new AbortController().signal, {
        models: () => ({
          ok: true,
          model: scriptedMockModel({
            modelId: "gpt-5.6-luna",
            steps: [{ kind: "text", text: "native reply" }],
          }),
          fallbacks: [],
        }),
      });
      assert.match(visibleTextFromEvents(events), /native reply/);
      const logged = JSON.stringify(lines);
      assert.match(logged, /"engine":"native"/);
      assert.equal(logged.includes("sk-or-secret"), false);
    } finally {
      console.info = original;
    }
  });

  it("calls Vercel with the turn token for an account tool and keeps the token out of the body", async () => {
    let auth = "";
    let body = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      auth = new Headers(init?.headers).get("authorization") ?? "";
      body = String(init?.body ?? "");
      return new Response(JSON.stringify({ ok: true, results: [{ title: "tea" }] }), { status: 200 });
    };
    const turn: AgentTurnRequest = {
      modelId: "gpt-5.6-luna",
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Remember tea" }] }] as UIMessage[],
      system: "Be brief.",
      conversationId: "c1",
      userId: "user-1",
      approvalMode: "ask",
      tools: ["memory_search"],
      depth: "standard",
      timeMinutes: null,
      timeZone: null,
      openRouterKey: null,
      turnToken: "header-turn-token",
      callbackOrigin: "https://app.example",
    };
    const events = await runNativeTurn(turn, new AbortController().signal, {
      allowCallback: true,
      fetchImpl,
      models: () => ({
        ok: true,
        model: scriptedMockModel({
          modelId: "gpt-5.6-luna",
          steps: [
            { kind: "tools", calls: [{ name: "memory_search", input: '{"query":"tea"}' }] },
            { kind: "text", text: "You like tea." },
          ],
        }),
        fallbacks: [],
      }),
    });
    assert.equal(auth, "Bearer header-turn-token");
    assert.match(body, /memory_search/);
    assert.equal(body.includes("header-turn-token"), false);
    assert.match(visibleTextFromEvents(events), /You like tea/);
  });

  it("drops sandbox tools when bubblewrap is unavailable and keeps them when it is", () => {
    const off = attachNativeTools(["web_search", "sandbox_exec", "sandbox_files", "memory_search"], {
      callbackOk: false,
      sandboxOk: false,
    });
    assert.deepEqual(
      off.map((tool) => tool.name),
      ["web_search"],
    );
    const on = attachNativeTools(["web_search", "sandbox_exec", "memory_search"], {
      callbackOk: true,
      sandboxOk: true,
    });
    assert.deepEqual(
      on.map((tool) => tool.name),
      ["web_search", "sandbox_exec", "memory_search"],
    );
    assert.equal(on.find((tool) => tool.name === "sandbox_exec")?.risk, "write");
  });
});
