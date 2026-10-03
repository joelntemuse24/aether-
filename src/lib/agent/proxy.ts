/**
 * Vercel proxy transport. The browser still receives an AI SDK UI message stream.
 * VM lines are `{ id, chunk }` NDJSON. Chunk objects are forwarded as-is.
 * Direct transport is intentionally rejected until a later change.
 */

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { UIMessage } from "ai";
import type { HarnessDepth } from "@/lib/harness/types";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";
import type { UiChunk } from "@/lib/trueforge/ui-chunks";
import { readAgentEngineFlag } from "./engine";
import { mintTurnToken } from "./turn-token";

export const NATIVE_ENGINE_UNAVAILABLE =
  "Aether's native engine is not available right now. Please try again.";
export const NATIVE_DIRECT_UNAVAILABLE =
  "The native engine's direct transport is not available yet.";
export const NATIVE_PROVIDER_UNSUPPORTED =
  "The native engine does not support that provider yet.";

export type AgentTransport = "proxy" | "direct";

export function readAgentTransport(
  env: Record<string, string | undefined> = process.env,
): AgentTransport {
  return (env.AETHER_AGENT_TRANSPORT ?? "").trim().toLowerCase() === "direct" ? "direct" : "proxy";
}

export function agentServerOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = (env.AETHER_AGENT_URL ?? "").trim().replace(/\/$/, "");
  return raw || null;
}

export type ProxyNativeChatInput = {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  conversationId: string;
  userId: string;
  messages: UIMessage[];
  system: string;
  modelId: string;
  approvalMode: ToolApprovalMode;
  depth: HarnessDepth;
  timeMinutes: number | null;
  tools?: readonly string[];
  abortSignal?: AbortSignal;
  openRouterKey?: string | null;
  requestId?: string;
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function emptyStream(): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: () => NATIVE_ENGINE_UNAVAILABLE,
  });
  return createUIMessageStreamResponse({ stream });
}

export async function proxyNativeAgentChat(input: ProxyNativeChatInput): Promise<Response> {
  const env = input.env ?? process.env;
  if (readAgentEngineFlag(env) !== "native") {
    return jsonError(NATIVE_ENGINE_UNAVAILABLE, 503);
  }
  if (readAgentTransport(env) === "direct") {
    return jsonError(NATIVE_DIRECT_UNAVAILABLE, 503);
  }
  const origin = agentServerOrigin(env);
  const secret = (env.AETHER_TRUEFORGE_TOKEN ?? "").trim();
  if (!origin || !secret) return jsonError(NATIVE_ENGINE_UNAVAILABLE, 503);
  if (input.abortSignal?.aborted) return emptyStream();

  const tools = [...(input.tools ?? [])];
  const requestId = input.requestId ?? crypto.randomUUID();
  const turnToken = await mintTurnToken(
    {
      sub: input.userId,
      conversationId: input.conversationId,
      tools,
      approvalMode: input.approvalMode,
      requestId,
    },
    secret,
  );
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  const openRouterKey = (input.openRouterKey ?? "").trim();
  if (openRouterKey) headers["x-openrouter-key"] = openRouterKey;
  const fetchImpl = input.fetchImpl ?? fetch;
  const upstreamAbort = new AbortController();
  let turnId: string | null = null;
  let canceling: Promise<void> | null = null;
  const cancel = (): Promise<void> => {
    if (!turnId) return Promise.resolve();
    if (!canceling) {
      canceling = fetchImpl(`${origin}/v1/turns/${encodeURIComponent(turnId)}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      })
        .then(() => undefined)
        .catch(() => undefined);
    }
    return canceling;
  };
  const onAbort = () => {
    upstreamAbort.abort();
    void cancel();
  };
  input.abortSignal?.addEventListener("abort", onAbort);
  let upstream: Response;
  try {
    upstream = await fetchImpl(`${origin}/v1/turns`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        turnToken,
        modelId: input.modelId,
        messages: input.messages,
        system: input.system,
        conversationId: input.conversationId,
        userId: input.userId,
        approvalMode: input.approvalMode,
        tools,
        depth: input.depth,
        timeMinutes: input.timeMinutes,
      }),
      signal: upstreamAbort.signal,
    });
  } catch {
    input.abortSignal?.removeEventListener("abort", onAbort);
    if (input.abortSignal?.aborted || upstreamAbort.signal.aborted) return emptyStream();
    return jsonError(NATIVE_ENGINE_UNAVAILABLE, 502);
  }
  if (!upstream.ok || !upstream.body) {
    input.abortSignal?.removeEventListener("abort", onAbort);
    console.error("[api/chat] native upstream", { status: upstream.status });
    return jsonError(NATIVE_ENGINE_UNAVAILABLE, 502);
  }

  turnId = upstream.headers.get("x-aether-turn-id");
  if (input.abortSignal?.aborted) await cancel();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UiChunk) => {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      };
      write({ type: "start" });
      let sawFinish = false;
      const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const take = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const parsed = JSON.parse(trimmed) as { chunk?: UiChunk };
        if (!parsed.chunk || typeof parsed.chunk !== "object") return;
        if (parsed.chunk.type === "start") return;
        if (parsed.chunk.type === "finish") sawFinish = true;
        write(parsed.chunk);
      };
      try {
        if (input.abortSignal?.aborted) {
          await cancel();
          write({ type: "finish", finishReason: "stop" });
          return;
        }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) take(line);
        }
        if (buf.trim()) take(buf);
        if (!sawFinish) write({ type: "finish", finishReason: "stop" });
      } catch (error) {
        if (input.abortSignal?.aborted || upstreamAbort.signal.aborted) {
          await cancel();
          if (!sawFinish) write({ type: "finish", finishReason: "stop" });
          return;
        }
        throw error;
      } finally {
        input.abortSignal?.removeEventListener("abort", onAbort);
      }
    },
    onError: () => NATIVE_ENGINE_UNAVAILABLE,
  });
  return createUIMessageStreamResponse({ stream });
}
