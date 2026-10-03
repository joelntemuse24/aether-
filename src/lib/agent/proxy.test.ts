import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { createAgentServer } from "../../agent-server/handler";
import { NATIVE_DIRECT_UNAVAILABLE, NATIVE_ENGINE_UNAVAILABLE, proxyNativeAgentChat } from "./proxy";

const secret = "test-secret";
const messages = [
  { id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] },
] as UIMessage[];

function listen(server: ReturnType<typeof createAgentServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function close(server: ReturnType<typeof createAgentServer>): Promise<void> {
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function envFor(origin: string, extra: Record<string, string> = {}) {
  return {
    AETHER_AGENT_ENGINE: "native",
    AETHER_AGENT_URL: origin,
    AETHER_TRUEFORGE_TOKEN: secret,
    ...extra,
  };
}

describe("native proxy", () => {
  it("does not call the VM unless the flag is native and the origin is set", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response("nope", { status: 500 });
    };
    const missing = await proxyNativeAgentChat({
      env: { AETHER_AGENT_ENGINE: "native" },
      fetchImpl,
      conversationId: "c1",
      userId: "user-1",
      messages,
      system: "Be brief.",
      modelId: "gpt-5.6-luna",
      approvalMode: "ask",
      depth: "standard",
      timeMinutes: null,
    });
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), { error: NATIVE_ENGINE_UNAVAILABLE });
    const unset = await proxyNativeAgentChat({
      env: { AETHER_AGENT_URL: "http://127.0.0.1:9", AETHER_TRUEFORGE_TOKEN: secret },
      fetchImpl,
      conversationId: "c1",
      userId: "user-1",
      messages,
      system: "Be brief.",
      modelId: "gpt-5.6-luna",
      approvalMode: "ask",
      depth: "standard",
      timeMinutes: null,
    });
    assert.equal(unset.status, 503);
    assert.equal(called, false);
    const direct = await proxyNativeAgentChat({
      env: envFor("http://127.0.0.1:9", { AETHER_AGENT_TRANSPORT: "direct" }),
      fetchImpl,
      conversationId: "c1",
      userId: "user-1",
      messages,
      system: "Be brief.",
      modelId: "gpt-5.6-luna",
      approvalMode: "ask",
      depth: "standard",
      timeMinutes: null,
    });
    assert.equal(direct.status, 503);
    assert.deepEqual(await direct.json(), { error: NATIVE_DIRECT_UNAVAILABLE });
    assert.equal(called, false);
  });

  it("forwards UiChunk objects and keeps the OpenRouter key out of the body", async () => {
    const toolChunk = {
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "web_search",
      input: { q: "seals" },
    };
    let openRouterKey: string | null = null;
    const server = createAgentServer({
      token: secret,
      runTurn: async (turn) => {
        openRouterKey = turn.openRouterKey;
        return [
          { id: "a", chunk: { type: "text-delta", id: "t1", delta: "hello from native" } },
          { id: "b", chunk: toolChunk },
        ];
      },
    });
    const origin = await listen(server);
    try {
      const response = await proxyNativeAgentChat({
        env: envFor(origin),
        conversationId: "c1",
        userId: "user-1",
        messages,
        system: "Be brief.",
        modelId: "gpt-5.6-luna",
        approvalMode: "ask",
        depth: "standard",
        timeMinutes: null,
        openRouterKey: "sk-or-secret",
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /hello from native/);
      assert.match(text, /tool-input-available/);
      assert.match(text, /web_search/);
      assert.match(text, /"q":"seals"/);
      assert.equal(text.includes("sk-or-secret"), false);
      assert.equal(openRouterKey, "sk-or-secret");
    } finally {
      await close(server);
    }
  });

  it("cancels the VM turn when the caller aborts", { timeout: 5_000 }, async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted = false;
    const server = createAgentServer({
      token: secret,
      runTurn: async (_turn, signal) => {
        release();
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            aborted = true;
            resolve();
            return;
          }
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        });
        return [];
      },
    });
    const origin = await listen(server);
    const controller = new AbortController();
    try {
      const pending = proxyNativeAgentChat({
        env: envFor(origin),
        conversationId: "c1",
        userId: "user-1",
        messages,
        system: "Be brief.",
        modelId: "gpt-5.6-luna",
        approvalMode: "ask",
        depth: "standard",
        timeMinutes: null,
        abortSignal: controller.signal,
      });
      await gate;
      const response = await pending;
      controller.abort();
      const text = await response.text();
      assert.equal(aborted, true);
      assert.equal(text.includes("sk-"), false);
      assert.match(text, /finish/);
    } finally {
      await close(server);
    }
  });
});
