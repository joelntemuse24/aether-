import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentServer, type AgentTurnRequest, type AgentTurnRunner } from "./handler";
import { mintTurnToken } from "@/lib/agent/turn-token";

const secret = "test-secret";

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

async function tokenFor(tools: string[] = [], sub = "user-1") {
  return mintTurnToken(
    {
      sub,
      conversationId: "c1",
      tools,
      approvalMode: "ask",
      requestId: "r1",
    },
    secret,
  );
}

function body(extra: Record<string, unknown> = {}) {
  return {
    modelId: "gpt-5.6-luna",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] }],
    system: "Be brief.",
    conversationId: "c1",
    userId: "user-1",
    approvalMode: "ask",
    tools: [],
    depth: "standard",
    timeMinutes: null,
    ...extra,
  };
}

describe("agent server", () => {
  it("opens health without a bearer and rejects other routes", async () => {
    const server = createAgentServer({ token: secret, runTurn: async () => [] });
    const origin = await listen(server);
    try {
      const health = await fetch(`${origin}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });
      const denied = await fetch(`${origin}/v1/turns`, { method: "POST" });
      assert.equal(denied.status, 401);
    } finally {
      await close(server);
    }
  });

  it("rejects an expired token, the wrong user, and a tool outside the allow-list", async () => {
    let calls = 0;
    const runTurn: AgentTurnRunner = async () => {
      calls += 1;
      return [];
    };
    const server = createAgentServer({ token: secret, runTurn });
    const origin = await listen(server);
    try {
      const headers = {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      };
      const expired = await mintTurnToken(
        {
          sub: "user-1",
          conversationId: "c1",
          tools: ["web_search"],
          approvalMode: "ask",
          requestId: "r1",
        },
        secret,
        { now: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 60_000) },
      );
      const expiredRes = await fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body(), turnToken: expired, tools: ["web_search"] }),
      });
      assert.equal(expiredRes.status, 401);

      const token = await tokenFor(["web_search"]);
      const wrongUser = await fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body({ userId: "user-2", tools: ["web_search"] }), turnToken: token }),
      });
      assert.equal(wrongUser.status, 403);

      const wrongTool = await fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...body({ tools: ["memory_write"] }),
          turnToken: token,
        }),
      });
      assert.equal(wrongTool.status, 403);
      assert.equal(calls, 0);
    } finally {
      await close(server);
    }
  });

  it("streams UiChunk events and resumes after an id", async () => {
    const toolChunk = {
      type: "tool-input-available",
      toolCallId: "c1",
      toolName: "web_search",
      input: { q: "seals" },
    };
    let seen: AgentTurnRequest | null = null;
    const runTurn: AgentTurnRunner = async (turn) => {
      seen = turn;
      return [
        { id: "loop-1", chunk: { type: "text-delta", id: "t1", delta: "hello from native" } },
        { id: "loop-2", chunk: toolChunk },
      ];
    };
    const server = createAgentServer({ token: secret, runTurn });
    const origin = await listen(server);
    try {
      const token = await tokenFor(["web_search"]);
      const response = await fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          "x-openrouter-key": "sk-or-secret",
        },
        body: JSON.stringify({
          ...body({ tools: ["web_search"], openRouterKey: "from-body" }),
          turnToken: token,
        }),
      });
      const turnId = response.headers.get("x-aether-turn-id");
      assert.match(turnId ?? "", /^[0-9a-f-]{36}$/);
      const raw = await response.text();
      assert.equal(raw.includes("sk-or-secret"), false);
      assert.equal(raw.includes("from-body"), false);
      const events = raw
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { id: string; chunk: Record<string, unknown> });
      assert.equal(events[0]?.chunk.delta, "hello from native");
      assert.deepEqual(events[1]?.chunk, toolChunk);
      assert.equal(seen?.openRouterKey, "sk-or-secret");
      assert.equal(JSON.stringify(seen).includes("from-body"), false);

      const resume = await fetch(`${origin}/v1/turns/${turnId}/events?after=1`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      const replay = (await resume.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { chunk: Record<string, unknown> });
      assert.equal(replay.length, 1);
      assert.deepEqual(replay[0]?.chunk, toolChunk);
      const unknown = await fetch(`${origin}/v1/turns/${turnId}/events?after=missing`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      const all = (await unknown.text()).trim().split("\n");
      assert.equal(all.length, 2);
    } finally {
      await close(server);
    }
  });

  it("cancel aborts the turn", { timeout: 5_000 }, async () => {
    let release: (value: void) => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let aborted = false;
    const runTurn: AgentTurnRunner = async (_turn, signal) => {
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
      return [{ id: "loop-1", chunk: { type: "text-delta", id: "t1", delta: "should-not-send" } }];
    };
    const server = createAgentServer({ token: secret, runTurn });
    const origin = await listen(server);
    try {
      const token = await tokenFor();
      const pending = fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body(), turnToken: token }),
      });
      await gate;
      const started = await pending;
      const turnId = started.headers.get("x-aether-turn-id");
      const cancel = await fetch(`${origin}/v1/turns/${turnId}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      assert.equal(cancel.status, 200);
      const raw = await started.text();
      assert.equal(aborted, true);
      assert.equal(raw.includes("should-not-send"), false);
    } finally {
      await close(server);
    }
  });

  it("writes a chunk before the turn function returns", { timeout: 5_000 }, async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = createAgentServer({
      token: secret,
      runTurn: async (_turn, _signal, onChunk) => {
        onChunk?.({ type: "text-delta", id: "t1", delta: "live" });
        await gate;
        return [{ id: "late", chunk: { type: "text-delta", id: "t1", delta: "late" } }];
      },
    });
    const origin = await listen(server);
    try {
      const token = await tokenFor();
      const response = await fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body(), turnToken: token }),
      });
      const reader = response.body?.getReader();
      assert.ok(reader);
      const decoder = new TextDecoder();
      let buf = "";
      while (!buf.includes("\n")) {
        const next = await reader.read();
        if (next.done) break;
        buf += decoder.decode(next.value, { stream: true });
      }
      assert.match(buf, /live/);
      assert.equal(buf.includes("late"), false);
      release();
      let rest = "";
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        rest += decoder.decode(next.value, { stream: true });
      }
      assert.equal(rest.includes("late"), false);
    } finally {
      await close(server);
    }
  });

  it("does not echo a thrown provider error", async () => {
    const server = createAgentServer({
      token: secret,
      runTurn: async () => {
        throw new Error("sk-secret boom");
      },
    });
    const origin = await listen(server);
    try {
      const token = await tokenFor();
      const response = await fetch(`${origin}/v1/turns`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body(), turnToken: token }),
      });
      const raw = await response.text();
      assert.equal(response.status, 200);
      assert.equal(raw.includes("sk-secret"), false);
      assert.match(raw, /Please try again/);
    } finally {
      await close(server);
    }
  });
});
