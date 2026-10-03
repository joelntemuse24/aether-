/**
 * One native turn on the VM. Tools are not executed here.
 * The per-turn OpenRouter header is only passed into the model client.
 */

import { AGENT_MODEL_UNAVAILABLE, buildAgentLanguageModels, type AgentModelBuild } from "@/lib/agent/models";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import type { AgentEvent } from "@/lib/agent/events";
import type { UiChunk } from "@/lib/trueforge/ui-chunks";
import type { AgentTurnRequest } from "./handler";

export type NativeTurnDeps = {
  env?: Record<string, string | undefined>;
  models?: (body: AgentTurnRequest) => AgentModelBuild | Promise<AgentModelBuild>;
  onChunk?: (chunk: UiChunk) => void;
};

function unavailableEvents(): AgentEvent[] {
  const text = AGENT_MODEL_UNAVAILABLE;
  return [
    { id: "1", chunk: { type: "text-start", id: "agent-final" } },
    { id: "2", chunk: { type: "text-delta", id: "agent-final", delta: text } },
    { id: "3", chunk: { type: "text-end", id: "agent-final" } },
  ];
}

export async function runNativeTurn(
  body: AgentTurnRequest,
  signal: AbortSignal,
  deps: NativeTurnDeps = {},
): Promise<AgentEvent[]> {
  console.info("[agent-server] engine", {
    engine: "native",
    conversationId: body.conversationId,
    modelId: body.modelId,
  });
  const env = deps.env ?? process.env;
  const built = await (deps.models ?? ((turn: AgentTurnRequest) =>
    buildAgentLanguageModels({
      modelId: turn.modelId,
      env,
      openRouterKey: turn.openRouterKey,
    })))(body);
  if (!built.ok) return unavailableEvents();
  const result: AgentLoopResult = await runAgentLoop({
    model: built.model,
    fallbackModels: built.fallbacks,
    modelId: body.modelId,
    conversationId: body.conversationId || null,
    incoming: body.messages,
    instructions: body.system,
    tools: [],
    depth: body.depth,
    timeMinutes: body.timeMinutes,
    approvalMode: body.approvalMode,
    abortSignal: signal,
    onChunk: deps.onChunk,
  });
  return result.events;
}
