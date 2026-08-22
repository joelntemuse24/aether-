/**
 * LEGACY in-process agent loop (BYOK + hosted fallback when Hermes is unset).
 *
 * Hosted chat with HERMES_BASE_URL + HERMES_API_KEY uses `src/lib/hermes`.
 * New loop / tool-unlock / prepareStep work belongs there — do not extend
 * this path except for BYOK regressions.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  InvalidToolInputError,
  NoSuchToolError,
  stepCountIs,
  streamText,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { repairToolCallInputJson } from "@/lib/repair-tool-json";
import { friendlyChatError } from "@/lib/chat-errors";
import { listHostedCandidates } from "@/lib/hosted/client";
import { createFailoverLanguageModel } from "@/lib/hosted/failover";
import { messageMentionsGitHubRepo } from "@/lib/connectors/github";
import {
  collectMessageText,
  collectSeedUnlockedToolNames,
  createAgentLoopController,
} from "@/lib/harness/loop-efficiency";
import { updateAgentRunStatus } from "@/lib/harness/runs-store";
import {
  buildToolRegistry,
  resolveAvailableToolNames,
} from "@/lib/harness/tool-registry";
import type { HarnessDepth, HarnessIntent } from "@/lib/harness/types";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";

export type LegacyProviderId = "openrouter" | "openai" | "anthropic" | "custom";

function resolveModel(provider: LegacyProviderId, model: string): string {
  if (provider === "anthropic") {
    return model.replace(/^anthropic\//, "");
  }
  if (provider === "openai") {
    return model.replace(/^openai\//, "");
  }
  return model;
}

function buildByokModel(input: {
  provider: LegacyProviderId;
  apiKey: string;
  baseURL: string;
  modelId: string;
  origin?: string | null;
}): LanguageModel {
  if (input.provider === "anthropic") {
    return createAnthropic({ apiKey: input.apiKey })(input.modelId);
  }
  const openai = createOpenAI({
    apiKey: input.apiKey,
    baseURL:
      input.baseURL ||
      (input.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : input.provider === "openai"
          ? "https://api.openai.com/v1"
          : input.baseURL),
    headers:
      input.provider === "openrouter"
        ? {
            "HTTP-Referer": input.origin ?? "http://localhost:3000",
            "X-Title": "Aether",
          }
        : undefined,
  });
  return openai.chat(input.modelId);
}

export type LegacyLocalStreamArgs = {
  hosted: boolean;
  requestedModel: string;
  provider: LegacyProviderId;
  apiKey: string;
  baseURL: string;
  origin?: string | null;
  messages: UIMessage[];
  enrichedMessages: UIMessage[];
  system?: string;
  toolsEnabled: boolean;
  userId: string | null;
  conversationId: string | null;
  projectId?: string;
  hasDrive: boolean;
  hasGitHub: boolean;
  harnessDepth: HarnessDepth;
  harnessIntent: HarnessIntent;
  harnessRunId?: string;
  maxSteps: number;
  maxWebSearches?: number | null;
  abortSignal?: AbortSignal;
  approvalMode?: ToolApprovalMode;
};

export async function streamLegacyLocalChat(
  args: LegacyLocalStreamArgs,
): Promise<Response> {
  let model: LanguageModel;
  if (args.hosted) {
    const candidates = listHostedCandidates(
      args.requestedModel,
      args.origin ?? null,
    );
    if (candidates.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "That model is not available on Aether Cloud right now. Pick another model or use Bring your own key.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    model = createFailoverLanguageModel(candidates);
  } else {
    model = buildByokModel({
      provider: args.provider,
      apiKey: args.apiKey,
      baseURL: args.baseURL,
      modelId: resolveModel(args.provider, args.requestedModel),
      origin: args.origin ?? null,
    });
  }

  const availableToolNames = args.toolsEnabled
    ? resolveAvailableToolNames({
        userId: args.userId,
        hasDrive: args.hasDrive,
        hasGitHub: args.hasGitHub,
      })
    : [];
  const threadText = args.toolsEnabled ? collectMessageText(args.messages) : "";
  const seedUnlocked = args.toolsEnabled
    ? collectSeedUnlockedToolNames({
        messages: args.messages,
        availableToolNames,
        mentionsGitHubRepo:
          args.hasGitHub && messageMentionsGitHubRepo(threadText),
        intentText: threadText,
      })
    : [];
  const loop = args.toolsEnabled
    ? createAgentLoopController({
        depth: args.harnessDepth,
        availableToolNames,
        seedUnlocked: seedUnlocked.length ? seedUnlocked : undefined,
        maxWebSearches: args.maxWebSearches ?? null,
      })
    : null;

  const result = streamText({
    model,
    messages: await convertToModelMessages(args.enrichedMessages),
    ...(args.system ? { system: args.system } : {}),
    ...(args.toolsEnabled && loop
      ? {
          tools: buildToolRegistry({
            userId: args.userId,
            conversationId: args.conversationId,
            projectId: args.projectId ?? null,
            hasDrive: args.hasDrive,
            hasGitHub: args.hasGitHub,
            approvalMode: args.approvalMode,
            loop,
          }),
          activeTools: loop.initialActiveTools,
          toolOrder: loop.toolOrder,
          prepareStep: () => loop.prepareStep(),
          stopWhen: stepCountIs(args.maxSteps),
          repairToolCall: async ({ toolCall, error }) => {
            if (NoSuchToolError.isInstance(error)) return null;
            if (!InvalidToolInputError.isInstance(error)) return null;
            const repaired = repairToolCallInputJson(toolCall.input);
            if (!repaired) return null;
            console.info("[chat] repaired tool input JSON", {
              tool: toolCall.toolName,
              before: toolCall.input.slice(0, 160),
              after: repaired.slice(0, 160),
            });
            return { ...toolCall, input: repaired };
          },
        }
      : {}),
    maxOutputTokens: 8192,
    maxRetries: args.hosted ? 0 : 2,
    abortSignal: args.abortSignal,
    onFinish: () => {
      if (args.harnessRunId && args.userId) {
        void updateAgentRunStatus({
          id: args.harnessRunId,
          userId: args.userId,
          status: "done",
          eventType: "chat_finished",
          eventPayload: {
            depth: args.harnessDepth,
            intent: args.harnessIntent,
            engine: "local",
          },
        });
      }
    },
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error("[api/chat]", error);
      if (args.harnessRunId && args.userId) {
        void updateAgentRunStatus({
          id: args.harnessRunId,
          userId: args.userId,
          status: "done",
          eventType: "chat_error",
          eventPayload: {
            error: error instanceof Error ? error.message : "error",
            engine: "local",
          },
        });
      }
      return friendlyChatError(error);
    },
  });
}
