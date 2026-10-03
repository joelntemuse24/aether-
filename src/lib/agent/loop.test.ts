import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import type { UIMessage } from "ai";
import { agentStepLimit, runAgentLoop } from "./loop";
import { scriptedMockModel } from "./mock-provider";
import type { AgentToolDefinition } from "./registry";

const search: AgentToolDefinition = {
  name: "web_search",
  description: "Search the public web.",
  inputSchema: z.object({ q: z.string() }),
  timeoutMs: 2_000,
  risk: "read",
  runsOn: "vm",
  requiresAuth: false,
};

const memory: AgentToolDefinition = {
  name: "memory_write",
  description: "Save a memory.",
  inputSchema: z.object({ note: z.string() }),
  timeoutMs: 2_000,
  risk: "write",
  runsOn: "vercel",
  requiresAuth: true,
};

const user: UIMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "What is the weather in Dublin?" }] },
];

function quiet<T extends { log?: () => void }>(extra: T) {
  return { ...extra, log() {} };
}

describe("agent loop", () => {
  it("uses the harness step budgets", () => {
    assert.equal(agentStepLimit("shallow"), 2);
    assert.equal(agentStepLimit("standard"), 8);
    assert.equal(agentStepLimit("deep"), 16);
    assert.equal(agentStepLimit("standard", 5), 6);
  });

  it("runs a tool and returns the model's cited answer", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "tools", calls: [{ name: "web_search", input: '{"q":"Dublin weather"}' }] },
        { kind: "text", text: "It is 12°C in Dublin [1].", reasoning: "check the forecast" },
      ],
    });
    const seen: unknown[] = [];
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        depth: "standard",
        executeTool: async (call) => {
          seen.push(call.input);
          return { ok: true, data: { results: [{ id: "1", title: "Met", snippet: "12C" }] } };
        },
      }),
    );
    assert.equal(result.engine, "native");
    assert.equal(result.status, "completed");
    assert.deepEqual(seen, [{ q: "Dublin weather" }]);
    assert.match(result.text, /Dublin \[1\]/);
    assert.match(JSON.stringify(result.events), /check the forecast/);
    assert.equal(result.events[0]?.id, "1");
  });

  it("repairs malformed tool JSON before the tool runs", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "tools", calls: [{ name: "web_search", input: '{"q":"wx"}{"q":"news"}' }] },
        { kind: "text", text: "Repaired." },
      ],
    });
    let seen: unknown;
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        executeTool: async (call) => {
          seen = call.input;
          return { ok: true, data: "ok" };
        },
      }),
    );
    assert.deepEqual(seen, { q: "wx" });
    assert.equal(result.status, "completed");
  });

  it("runs parallel tool calls and can cap them to one at a time", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        {
          kind: "tools",
          calls: [
            { id: "a", name: "web_search", input: '{"q":"one"}' },
            { id: "b", name: "web_search", input: '{"q":"two"}' },
          ],
        },
        { kind: "text", text: "Both done." },
      ],
    });
    let active = 0;
    let maxActive = 0;
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        concurrency: 1,
        executeTool: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 40));
          active -= 1;
          return { ok: true, data: "ok" };
        },
      }),
    );
    assert.equal(result.text, "Both done.");
    assert.equal(maxActive, 1);
  });

  it("forces unknown models to run tools one at a time", async () => {
    const model = scriptedMockModel({
      modelId: "mystery-model",
      steps: [
        {
          kind: "tools",
          calls: [
            { id: "a", name: "web_search", input: '{"q":"one"}' },
            { id: "b", name: "web_search", input: '{"q":"two"}' },
          ],
        },
        { kind: "text", text: "Sequential." },
      ],
    });
    let active = 0;
    let maxActive = 0;
    await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        concurrency: 8,
        executeTool: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 30));
          active -= 1;
          return { ok: true, data: "ok" };
        },
      }),
    );
    assert.equal(maxActive, 1);
  });

  it("strips a leaked-markup answer and still finishes", async () => {
    const model = scriptedMockModel({
      modelId: "deepseek-chat",
      steps: [{ kind: "text", text: '<|DSML| tool_name=web_search query="x">' }],
    });
    const result = await runAgentLoop(quiet({ model, incoming: user, tools: [search] }));
    assert.equal(result.text.includes("DSML"), false);
    assert.match(result.text, /formatting error/);
    assert.equal(result.status, "completed");
  });

  it("retries a mid-stream 502 once, then uses the fallback model", async () => {
    const primary = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "midstream-error", statusCode: 502, text: "partial" },
        { kind: "midstream-error", statusCode: 502, text: "partial" },
      ],
    });
    const fallback = scriptedMockModel({
      modelId: "claude-sonnet-5",
      steps: [{ kind: "text", text: "Recovered from the fallback." }],
    });
    const result = await runAgentLoop(
      quiet({
        model: primary,
        fallbackModels: [fallback],
        incoming: user,
        tools: [search],
      }),
    );
    assert.equal(primary.doStreamCalls.length, 2);
    assert.equal(fallback.doStreamCalls.length, 1);
    assert.equal(result.text, "Recovered from the fallback.");
    assert.equal(result.text.includes("partial"), false);
    assert.equal(result.modelId, "claude-sonnet-5");
    const claudeOptions = JSON.stringify(fallback.doStreamCalls[0]?.providerOptions ?? {});
    assert.equal(claudeOptions.includes("reasoningEffort"), false);
  });

  it("does not leak a provider error when every model fails", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [{ kind: "throw", statusCode: 502 }],
    });
    const result = await runAgentLoop(quiet({ model, incoming: user }));
    assert.equal(result.status, "error");
    assert.match(result.text, /stopped before it could finish/);
    assert.equal(result.text.includes("provider error"), false);
    assert.equal(result.text.includes("502"), false);
  });

  it("turns a tool timeout into a tool error and continues", async () => {
    const slow: AgentToolDefinition = { ...search, timeoutMs: 30 };
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "tools", calls: [{ name: "web_search", input: '{"q":"slow"}' }] },
        { kind: "text", text: "The lookup timed out." },
      ],
    });
    const started = Date.now();
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [slow],
        executeTool: () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: true, data: "late" }), 5_000);
          }),
      }),
    );
    assert.equal(result.text, "The lookup timed out.");
    assert.ok(Date.now() - started < 2_000);
    const second = JSON.stringify(model.doStreamCalls[1]?.prompt ?? "");
    assert.match(second, /Tool timed out/);
    assert.equal(second.includes("late"), false);
  });

  it("turns a thrown tool error into a structured failure", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "tools", calls: [{ name: "web_search", input: '{"q":"x"}' }] },
        { kind: "text", text: "The tool failed, so I stopped there." },
      ],
    });
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        executeTool: async () => {
          throw new Error("sk-secret boom");
        },
      }),
    );
    assert.match(result.text, /tool failed/i);
    const encoded = JSON.stringify(result.events);
    assert.equal(encoded.includes("sk-secret"), false);
    assert.match(JSON.stringify(model.doStreamCalls[1]?.prompt), /Tool failed/);
  });

  it("caps a huge tool result before the next model call", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "tools", calls: [{ name: "web_search", input: '{"q":"big"}' }] },
        { kind: "text", text: "Short answer." },
      ],
    });
    await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        executeTool: async () => ({ ok: true, data: "x".repeat(40_000) + "END_MARKER" }),
      }),
    );
    const second = JSON.stringify(model.doStreamCalls[1]?.prompt ?? "");
    assert.equal(second.includes("END_MARKER"), false);
    assert.match(second, /truncated/);
  });

  it("stops a shallow turn on the step budget", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [{ kind: "tools", calls: [{ name: "web_search", input: '{"q":"again"}' }] }],
    });
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        depth: "shallow",
        tools: [search],
        executeTool: async () => ({ ok: true, data: { results: [{ id: "1", title: "Met", snippet: "12" }] } }),
      }),
    );
    assert.ok(model.doStreamCalls.length <= 2);
    assert.ok(result.text.length > 0);
    assert.notEqual(result.status, "error");
  });

  it("aborts the tool and does not call the model again", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [{ kind: "tools", calls: [{ name: "web_search", input: '{"q":"stop"}' }] }],
    });
    const controller = new AbortController();
    let sawAbort = false;
    let settled = false;
    const result = await runAgentLoop(
      quiet({
        model,
        incoming: user,
        tools: [search],
        abortSignal: controller.signal,
        executeTool: async (call) => {
          await new Promise<void>((_resolve, reject) => {
            if (call.abortSignal.aborted) {
              sawAbort = true;
              reject(call.abortSignal.reason);
              return;
            }
            call.abortSignal.addEventListener("abort", () => {
              sawAbort = true;
              reject(call.abortSignal.reason ?? new DOMException("aborted", "AbortError"));
            });
            setTimeout(() => controller.abort(), 20);
          });
          settled = true;
          return { ok: true, data: "should-not-run" };
        },
      }),
    );
    assert.equal(result.status, "aborted");
    assert.equal(sawAbort, true);
    assert.equal(settled, false);
    assert.equal(model.doStreamCalls.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false);
  });

  it("waits for approval on a write and runs it when the gate is already open", async () => {
    const asking = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [{ kind: "tools", calls: [{ id: "mem1", name: "memory_write", input: '{"note":"tea"}' }] }],
    });
    let ran = 0;
    const ask = await runAgentLoop(
      quiet({
        model: asking,
        incoming: user,
        tools: [memory],
        approvalMode: "ask",
        executeTool: async () => {
          ran += 1;
          return { ok: true, data: "saved" };
        },
      }),
    );
    assert.equal(ran, 0);
    assert.equal(ask.status, "awaiting_approval");
    assert.equal(ask.pendingApprovals[0]?.toolName, "memory_write");
    assert.match(JSON.stringify(ask.events), /needs_confirmation/);

    const auto = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [
        { kind: "tools", calls: [{ id: "mem1", name: "memory_write", input: '{"note":"tea"}' }] },
        { kind: "text", text: "Saved." },
      ],
    });
    const approved = await runAgentLoop(
      quiet({
        model: auto,
        incoming: user,
        tools: [memory],
        approvalMode: "ask",
        approvedToolCallIds: ["mem1"],
        executeTool: async () => {
          ran += 1;
          return { ok: true, data: "saved" };
        },
      }),
    );
    assert.equal(ran, 1);
    assert.equal(approved.status, "completed");
    assert.equal(approved.text, "Saved.");
  });

  it("sends the stored conversation, not only the latest message", async () => {
    const model = scriptedMockModel({
      modelId: "gpt-5.6-luna",
      steps: [{ kind: "text", text: "Continuing." }],
    });
    await runAgentLoop(
      quiet({
        model,
        conversationId: "c1",
        stored: [
          { id: "1", role: "user", parts: [{ type: "text", text: "earlier question about seals" }] },
          { id: "2", role: "assistant", parts: [{ type: "text", text: "earlier answer" }] },
        ],
        incoming: [{ id: "3", role: "user", parts: [{ type: "text", text: "and now?" }] }],
      }),
    );
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt ?? "");
    assert.match(prompt, /earlier question about seals/);
    assert.match(prompt, /and now/);
  });

  it("does not put a reasoning effort on Claude", async () => {
    const model = scriptedMockModel({
      modelId: "claude-sonnet-5",
      steps: [{ kind: "text", text: "Hello." }],
    });
    await runAgentLoop(quiet({ model, incoming: user }));
    const options = model.doStreamCalls[0]?.providerOptions;
    assert.equal(options, undefined);
  });
});
