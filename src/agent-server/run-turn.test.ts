import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { scriptedMockModel } from "@/lib/agent/mock-provider";
import { visibleTextFromEvents } from "@/lib/agent/events";
import type { AgentTurnRequest } from "./handler";
import { runNativeTurn } from "./run-turn";

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
      openRouterKey: "sk-or-secret",
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
});
