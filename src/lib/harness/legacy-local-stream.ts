/**
 * LEGACY in-process agent loop (BYOK + hosted fallback when Hermes is unset).
 *
 * Default hosted + BYOK path. Hermes is opt-in only (`HERMES_ENABLED=1`).
 */

import { resolveTurnLanguageModel } from "@/lib/chat-language-model";
import {
  convertToModelMessages,
  InvalidToolInputError,
  NoSuchToolError,
  stepCountIs,
  streamText,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
} from "ai";
import { repairToolCallInputJson } from "@/lib/repair-tool-json";
import { friendlyChatError } from "@/lib/chat-errors";
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
import { ensureDurableToolStubs } from "@/lib/chat-tool-transcript";

export type LegacyProviderId = "openrouter" | "openai" | "anthropic" | "custom";

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
  /** Pre-converted model messages (durable agent). */
  modelMessages?: ModelMessage[];
  /** Pre-built tools (durable agent). */
  tools?: ToolSet;
  /** Spread first into streamText (durable agent toStreamTextOptions). */
  extraStreamTextOptions?: Record<string, unknown>;
  /** Return the streamText result instead of an HTTP Response. */
  asStreamResult?: boolean;
};

export async function runLegacyLocalChat(args: LegacyLocalStreamArgs) {
  const model = resolveTurnLanguageModel({
    hosted: args.hosted,
    provider: args.provider,
    apiKey: args.apiKey,
    baseURL: args.baseURL,
    modelId: args.requestedModel,
    origin: args.origin ?? null,
  });
  if (!model) {
    return new Response(
      JSON.stringify({
        error: args.hosted
          ? "That model is not available on Aether Cloud right now. Pick another model or use Bring your own key."
          : "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
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

  const modelMessages =
    args.modelMessages ??
    (await convertToModelMessages(ensureDurableToolStubs(args.enrichedMessages), {
      ignoreIncompleteToolCalls: true,
    }));

  const tools =
    args.tools ??
    (args.toolsEnabled && loop
      ? buildToolRegistry({
          userId: args.userId,
          conversationId: args.conversationId,
          projectId: args.projectId ?? null,
          hasDrive: args.hasDrive,
          hasGitHub: args.hasGitHub,
          approvalMode: args.approvalMode,
          loop,
        })
      : undefined);

  const result = streamText({
    ...(args.extraStreamTextOptions as object | undefined),
    model,
    messages: modelMessages,
    ...(args.system ? { system: args.system } : {}),
    ...(args.toolsEnabled && loop && tools
      ? {
          tools,
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

  if (args.asStreamResult) return result;

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

export async function streamLegacyLocalChat(
  args: LegacyLocalStreamArgs,
): Promise<Response> {
  const result = await runLegacyLocalChat({ ...args, asStreamResult: false });
  return result as Response;
}
