/**
 * One native turn on the VM. Web tools run here. Account tools call back
 * to Vercel with the turn token. The per-turn OpenRouter header is only
 * passed into the model client.
 */

import { definitionsForAllowList } from "@/lib/agent/catalog";
import { executeNativeTool } from "@/lib/agent/execute-native";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgentLoop, type AgentLoopResult } from "@/lib/agent/loop";
import { AGENT_MODEL_UNAVAILABLE, buildAgentLanguageModels, type AgentModelBuild } from "@/lib/agent/models";
import { agentToolGroup, type AgentToolDefinition, type AgentToolExecute, type AgentToolGroup } from "@/lib/agent/registry";
import { bubblewrapAvailable, createBubblewrapSandbox, type AgentSandbox } from "@/lib/agent/sandbox";
import { sandboxDirectoryKey } from "@/lib/agent/sandbox-key";
import type { WebExecDeps } from "@/lib/agent/web-exec";
import { assertPublicHttpUrl } from "@/lib/connectors/url-safety";
import type { UiChunk } from "@/lib/trueforge/ui-chunks";
import type { AgentTurnRequest } from "./handler";

export type NativeTurnDeps = {
  env?: Record<string, string | undefined>;
  models?: (body: AgentTurnRequest) => AgentModelBuild | Promise<AgentModelBuild>;
  onChunk?: (chunk: UiChunk) => void;
  executeTool?: AgentToolExecute;
  fetchImpl?: typeof fetch;
  /** Test hook. Production checks the callback origin with the public-URL rule. */
  allowCallback?: boolean;
  web?: WebExecDeps;
  /** When set, skip the bwrap probe. Production probes only if a sandbox tool is allowed. */
  sandboxAvailable?: boolean;
  sandbox?: AgentSandbox;
};

export function attachNativeTools(
  names: readonly string[],
  options: { callbackOk: boolean; sandboxOk: boolean },
): AgentToolDefinition[] {
  return definitionsForAllowList(names).filter((definition) => {
    if (definition.runsOn === "vercel" && !options.callbackOk) return false;
    if (agentToolGroup(definition.name) === "sandbox" && !options.sandboxOk) return false;
    return true;
  });
}

function unavailableGroups(definitions: readonly { name: string }[]): AgentToolGroup[] {
  const present = new Set(
    definitions
      .map((definition) => agentToolGroup(definition.name))
      .filter((group): group is AgentToolGroup => group != null),
  );
  return (["web", "account", "sandbox"] as const).filter((group) => !present.has(group));
}

async function callbackOriginAllowed(origin: string | null, allowCallback: boolean): Promise<boolean> {
  if (!origin) return false;
  if (allowCallback) return true;
  return (await assertPublicHttpUrl(origin)).ok;
}

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
  const callbackOk = await callbackOriginAllowed(body.callbackOrigin, deps.allowCallback === true);
  const listed = definitionsForAllowList(body.tools);
  const wantsSandbox = listed.some((definition) => agentToolGroup(definition.name) === "sandbox");
  const probed =
    deps.sandboxAvailable != null
      ? deps.sandboxAvailable
      : wantsSandbox
        ? await bubblewrapAvailable()
        : false;
  const identityOk = sandboxDirectoryKey(body.userId, body.conversationId) != null;
  const sandboxOk = probed && (deps.sandbox != null || identityOk);
  const tools = attachNativeTools(body.tools, { callbackOk, sandboxOk });
  const sandbox = sandboxOk
    ? (deps.sandbox ??
      createBubblewrapSandbox({
        conversationId: body.conversationId,
        userId: body.userId,
        env,
      }))
    : null;
  const result: AgentLoopResult = await runAgentLoop({
    model: built.model,
    fallbackModels: built.fallbacks,
    modelId: body.modelId,
    conversationId: body.conversationId || null,
    incoming: body.messages,
    instructions: body.system,
    tools,
    executeTool:
      deps.executeTool ??
      ((call) =>
        executeNativeTool({
          name: call.name,
          args: call.input,
          abortSignal: call.abortSignal,
          turnToken: body.turnToken,
          callbackOrigin: callbackOk ? body.callbackOrigin : null,
          fetchImpl: deps.fetchImpl,
          checkOrigin: deps.allowCallback ? async () => true : undefined,
          web: deps.web,
          sandbox,
        })),
    unavailableGroups: unavailableGroups(tools),
    depth: body.depth,
    timeMinutes: body.timeMinutes,
    approvalMode: body.approvalMode,
    abortSignal: signal,
    onChunk: deps.onChunk,
  });
  return result.events;
}
