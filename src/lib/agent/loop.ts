/**
 * Model-agnostic tool loop. Callers pass a Vercel AI SDK model.
 * The chat route does not call this until AETHER_AGENT_ENGINE=native.
 */

import { budgetForDepthWithTime } from "@/lib/harness/budgets";
import { collectMessageText } from "@/lib/harness/loop-efficiency";
import type { HarnessDepth, HarnessIntent } from "@/lib/harness/types";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";
import { synthesizeFallbackAnswer, shouldForceTextStep, type ToolEvidence } from "@/lib/final-answer";
import { repairToolCallInputJson } from "@/lib/repair-tool-json";
import type { UiChunk } from "@/lib/trueforge/ui-chunks";
import { looksLikeRawToolMarkup } from "@/lib/visible-chat-text";
import {
  APICallError,
  InvalidToolInputError,
  NoSuchToolError,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import {
  createAgentEventLog,
  sanitizeUiChunks,
  visibleTextFromChunks,
  withFinalText,
  type AgentEvent,
} from "./events";
import { prepareAgentHistory } from "./history";
import { agentModelProfile, agentProviderOptions } from "./profiles";
import {
  agentSystemPrompt,
  selectAgentTools,
  toAiSdkTools,
  type AgentToolDefinition,
  type AgentToolExecute,
  type AgentToolGroup,
  type PendingApproval,
} from "./registry";

export const AGENT_ENGINE = "native" as const;

export const AGENT_FINAL_ERROR = "The model stopped before it could finish. Please try again.";
export const AGENT_EMPTY_ANSWER = "I couldn't finish that answer. Please try again.";
export const AGENT_MARKUP_ANSWER =
  "I hit a formatting error and couldn't finish that answer. Please try again.";

export type AgentLoopStatus =
  | "completed"
  | "aborted"
  | "error"
  | "step_limit"
  | "awaiting_approval";

export type AgentTurnLog = {
  engine: typeof AGENT_ENGINE;
  modelId: string;
  conversationId: string | null;
  status: AgentLoopStatus;
  steps: number;
};

export type RunAgentLoopInput = {
  model: LanguageModel;
  fallbackModels?: LanguageModel[];
  modelId?: string;
  conversationId?: string | null;
  incoming: UIMessage[];
  stored?: UIMessage[];
  instructions?: string;
  tools?: readonly AgentToolDefinition[];
  executeTool?: AgentToolExecute;
  unavailableGroups?: readonly AgentToolGroup[];
  depth?: HarnessDepth;
  intent?: HarnessIntent;
  timeMinutes?: number | null;
  approvalMode?: ToolApprovalMode;
  approvedToolCallIds?: readonly string[];
  concurrency?: number;
  abortSignal?: AbortSignal;
  now?: Date;
  log?: (entry: AgentTurnLog) => void;
};

export type AgentLoopResult = {
  engine: typeof AGENT_ENGINE;
  status: AgentLoopStatus;
  events: AgentEvent[];
  text: string;
  steps: number;
  modelId: string;
  pendingApprovals: PendingApproval[];
};

export function agentStepLimit(depth: HarnessDepth | undefined, timeMinutes?: number | null): number {
  return budgetForDepthWithTime(depth, timeMinutes).maxSteps;
}

const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

export function isTransientProviderError(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (error.statusCode != null && TRANSIENT_STATUS.has(error.statusCode)) return true;
    return false;
  }
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === "number" && TRANSIENT_STATUS.has(code)) return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(message);
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return !!error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError";
}

function modelIdOf(model: LanguageModel, fallback: string): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && "modelId" in model && typeof model.modelId === "string") {
    return model.modelId;
  }
  return fallback;
}

function defaultLog(entry: AgentTurnLog) {
  console.info("[agent]", {
    engine: entry.engine,
    modelId: entry.modelId,
    conversationId: entry.conversationId,
    status: entry.status,
    steps: entry.steps,
  });
}

function rawText(chunks: readonly UiChunk[]): string {
  let text = "";
  for (const chunk of chunks) {
    if (chunk.type !== "text-delta") continue;
    if (typeof chunk.delta === "string") text += chunk.delta;
    else if (typeof chunk.text === "string") text += chunk.text;
  }
  return text;
}

type Attempt = {
  chunks: UiChunk[];
  steps: number;
  transient: boolean;
  aborted: boolean;
};

async function readUiChunks(stream: AsyncIterable<unknown>): Promise<UiChunk[]> {
  const chunks: UiChunk[] = [];
  for await (const chunk of stream) {
    if (chunk && typeof chunk === "object") chunks.push(chunk as UiChunk);
  }
  return chunks;
}

export async function runAgentLoop(input: RunAgentLoopInput): Promise<AgentLoopResult> {
  const conversationId = input.conversationId ?? null;
  const depth = input.depth ?? "standard";
  const maxSteps = agentStepLimit(depth, input.timeMinutes);
  const history = await prepareAgentHistory({
    conversationId,
    incoming: input.incoming,
    stored: input.stored,
  });
  const userText = collectMessageText(history.uiMessages);
  const definitions = input.tools ?? [];
  const executeTool: AgentToolExecute =
    input.executeTool ??
    (async () => ({ ok: false, error: "Tool is not available.", retryable: false }));
  const pending: PendingApproval[] = [];
  const log = input.log ?? defaultLog;

  const finish = (status: AgentLoopStatus, chunks: UiChunk[], steps: number, modelId: string): AgentLoopResult => {
    const published = publishEvents(chunks, userText, status);
    log({ engine: AGENT_ENGINE, modelId, conversationId, status, steps });
    return {
      engine: AGENT_ENGINE,
      status,
      events: published.events,
      text: published.text,
      steps,
      modelId,
      pendingApprovals: pending,
    };
  };

  // streamText maxRetries does not replay a 502 after the first byte.
  // Retry the primary model once with the original history, then the fallback chain.
  const chain = [input.model, ...(input.fallbackModels ?? [])];
  let lastSteps = 0;
  let lastModelId = input.modelId ?? modelIdOf(input.model, "unknown");

  for (let index = 0; index < chain.length; index += 1) {
    const model = chain[index]!;
    const modelId = modelIdOf(model, input.modelId ?? lastModelId);
    const tries = index === 0 ? 2 : 1;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      if (input.abortSignal?.aborted) return finish("aborted", [], lastSteps, modelId);
      const outcome = await runAttempt({
        model,
        modelId,
        messages: history.modelMessages,
        maxSteps,
        definitions,
        executeTool,
        instructions: input.instructions,
        unavailableGroups: input.unavailableGroups,
        depth,
        intent: input.intent,
        now: input.now,
        approvalMode: input.approvalMode,
        approvedToolCallIds: input.approvedToolCallIds,
        concurrency: input.concurrency,
        abortSignal: input.abortSignal,
        onApproval: (item) => pending.push(item),
      });
      lastSteps = outcome.steps;
      lastModelId = modelId;
      if (outcome.aborted) return finish("aborted", outcome.chunks, outcome.steps, modelId);
      if (pending.length > 0) {
        return finish("awaiting_approval", outcome.chunks, outcome.steps, modelId);
      }
      if (!outcome.transient) {
        const visible = visibleTextFromChunks(sanitizeUiChunks(outcome.chunks));
        const status: AgentLoopStatus =
          outcome.steps >= maxSteps && visible.length === 0 ? "step_limit" : "completed";
        return finish(status, outcome.chunks, outcome.steps, modelId);
      }
    }
  }

  return finish("error", [], lastSteps, lastModelId);
}

async function runAttempt(input: {
  model: LanguageModel;
  modelId: string;
  messages: ModelMessage[];
  maxSteps: number;
  definitions: readonly AgentToolDefinition[];
  executeTool: AgentToolExecute;
  instructions?: string;
  unavailableGroups?: readonly AgentToolGroup[];
  depth: HarnessDepth;
  intent?: HarnessIntent;
  now?: Date;
  approvalMode?: ToolApprovalMode;
  approvedToolCallIds?: readonly string[];
  concurrency?: number;
  abortSignal?: AbortSignal;
  onApproval: (pending: PendingApproval) => void;
}): Promise<Attempt> {
  const profile = agentModelProfile(input.modelId);
  const selected = selectAgentTools(input.definitions, profile);
  const providerOptions = agentProviderOptions(profile);
  const system = agentSystemPrompt({
    base: input.instructions,
    definitions: selected,
    unavailableGroups: input.unavailableGroups,
    now: input.now,
    depth: input.depth,
    intent: input.intent,
  });
  const errors: unknown[] = [];
  let paused = false;
  const stepLimit = stepCountIs(input.maxSteps);
  const result = streamText({
    model: input.model,
    messages: input.messages,
    system,
    maxRetries: 0,
    abortSignal: input.abortSignal,
    ...(providerOptions ? { providerOptions } : {}),
    ...(selected.length
      ? {
          tools: toAiSdkTools({
            definitions: selected,
            profile,
            executeTool: input.executeTool,
            approvalMode: input.approvalMode,
            concurrency: input.concurrency,
            approvedToolCallIds: input.approvedToolCallIds,
            parentSignal: input.abortSignal,
            onApproval: (item) => {
              paused = true;
              input.onApproval(item);
            },
          }),
          stopWhen: (options) => paused || stepLimit(options),
          prepareStep: ({ stepNumber }) => {
            if (paused || shouldForceTextStep({ stepNumber, maxSteps: input.maxSteps })) {
              return { activeTools: [], toolChoice: "none" as const };
            }
            return {};
          },
          repairToolCall: async ({ toolCall, error }) => {
            if (NoSuchToolError.isInstance(error) || !InvalidToolInputError.isInstance(error)) return null;
            const raw = typeof toolCall.input === "string" ? toolCall.input : "";
            const repaired = repairToolCallInputJson(raw);
            if (!repaired) return null;
            return { ...toolCall, input: repaired };
          },
        }
      : {}),
    onError: ({ error }) => {
      errors.push(error);
    },
  });

  let chunks: UiChunk[] = [];
  let aborted = false;
  try {
    chunks = await readUiChunks(
      result.toUIMessageStream({
        sendReasoning: true,
        onError: () => AGENT_FINAL_ERROR,
      }),
    );
  } catch (error) {
    if (isAbortError(error, input.abortSignal)) aborted = true;
    else errors.push(error);
  }
  if (input.abortSignal?.aborted) aborted = true;

  let steps = 0;
  if (!aborted) {
    try {
      steps = (await result.steps).length;
    } catch (error) {
      if (isAbortError(error, input.abortSignal)) aborted = true;
      else errors.push(error);
    }
  }

  return {
    chunks,
    steps,
    transient: !aborted && errors.some((error) => isTransientProviderError(error)),
    aborted,
  };
}

function publishEvents(
  chunks: UiChunk[],
  userText: string,
  status: AgentLoopStatus,
): { events: AgentEvent[]; text: string } {
  const sanitized = sanitizeUiChunks(chunks);
  const visible = visibleTextFromChunks(sanitized);
  const tools = toolEvidence(chunks);
  let sentence = "";
  if (!visible) {
    if (looksLikeRawToolMarkup(rawText(chunks))) sentence = AGENT_MARKUP_ANSWER;
    else if (status === "error") sentence = AGENT_FINAL_ERROR;
    else if (status === "aborted") sentence = "";
    else if (tools.length > 0) sentence = synthesizeFallbackAnswer({ userText, tools });
    else if (status === "awaiting_approval") sentence = "Waiting for your approval.";
    else sentence = AGENT_EMPTY_ANSWER;
  }
  const finalChunks = sentence ? withFinalText(sanitized, sentence) : sanitized;
  const log = createAgentEventLog();
  for (const chunk of finalChunks) log.push(chunk);
  return { events: log.all(), text: visibleTextFromChunks(finalChunks) };
}

function toolEvidence(chunks: readonly UiChunk[]): ToolEvidence[] {
  const names = new Map<string, string>();
  const evidence: ToolEvidence[] = [];
  for (const chunk of chunks) {
    if (chunk.type === "tool-input-available" && typeof chunk.toolCallId === "string") {
      names.set(chunk.toolCallId, typeof chunk.toolName === "string" ? chunk.toolName : "tool");
    }
    if (chunk.type === "tool-output-available" && typeof chunk.toolCallId === "string") {
      evidence.push({
        name: names.get(chunk.toolCallId) || "tool",
        output: chunk.output,
      });
    }
  }
  return evidence;
}
