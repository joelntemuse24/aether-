import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { IncomingAttachment } from "@/lib/chat-turn";
import { encodeTrueForgeApproval } from "./approvals";
import { trueforgeClient, trueforgeModelChoice, trueforgeSessionId, switchTrueForgeSessionModel } from "./sessions";
import {
  chunksForTrueForgeEvent,
  closeTrueForgeUi,
  createTrueForgeUiState,
  type UiChunk,
} from "./ui-chunks";
import { buildTrueForgeUserContent } from "./user-content";

export function shouldFailoverTrueForgeTurn(input: {
  failedBeforeOutput: boolean;
  fallback: string | null;
  usedFallback: boolean;
}): boolean {
  return input.failedBeforeOutput && !!input.fallback && !input.usedFallback;
}

type CollectedTurn = {
  chunks: UiChunk[];
  failedBeforeOutput: boolean;
};

async function collectTurn(input: {
  sessionId: string;
  content: ReturnType<typeof buildTrueForgeUserContent>;
  abortSignal?: AbortSignal;
  previousTurnId?: "auto" | "none";
}): Promise<CollectedTurn> {
  const state = createTrueForgeUiState();
  const chunks: UiChunk[] = [];
  let sawContent = false;
  let failed = false;
  try {
    const turn = await trueforgeClient().sessions.createTurnStream(
      input.sessionId,
      {
        input: [{ type: "user.message", content: input.content }],
        previousTurnId: input.previousTurnId ?? "auto",
      },
      { abortSignal: input.abortSignal },
    );
    for await (const event of turn) {
      let payload: { type?: string; [key: string]: unknown } = event as unknown as {
        type?: string;
        [key: string]: unknown;
      };
      if (event.type === "tool.approval_required") {
        payload = {
          ...payload,
          sessionId: input.sessionId,
          toolCalls: event.toolCalls.map((call) => ({
            ...call,
            confirmationId: encodeTrueForgeApproval({
              sessionId: input.sessionId,
              threadId: event.threadId,
              toolCallId: call.id,
            }),
          })),
        };
      }
      for (const chunk of chunksForTrueForgeEvent(payload, state)) {
        if (
          chunk.type === "text-delta" ||
          chunk.type === "tool-input-available" ||
          chunk.type === "reasoning-delta"
        ) {
          sawContent = true;
        }
        if (chunk.type === "error") failed = true;
        chunks.push(chunk);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The harness turn failed.";
    chunks.push({ type: "error", errorText: message });
    chunks.push(...closeTrueForgeUi(state));
    return { chunks, failedBeforeOutput: !sawContent };
  }
  chunks.push(...closeTrueForgeUi(state));
  return { chunks, failedBeforeOutput: failed && !sawContent };
}

export async function streamTrueForgeHostedChat(input: {
  conversationId: string | null;
  userText: string;
  system: string;
  attachments?: IncomingAttachment[];
  abortSignal?: AbortSignal;
}): Promise<Response> {
  const conversationId = input.conversationId || `guest-${crypto.randomUUID()}`;
  const content = buildTrueForgeUserContent(input.userText || "", input.attachments ?? []);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      const choice = await trueforgeModelChoice();
      const session = await trueforgeSessionId({
        conversationId,
        modelName: choice.primary,
        instructions: input.system,
      });
      let collected = await collectTurn({
        sessionId: session.id,
        content,
        abortSignal: input.abortSignal,
      });
      if (
        shouldFailoverTrueForgeTurn({
          failedBeforeOutput: collected.failedBeforeOutput,
          fallback: choice.fallback,
          usedFallback: session.model === choice.fallback,
        }) &&
        choice.fallback
      ) {
        await switchTrueForgeSessionModel({
          conversationId,
          sessionId: session.id,
          modelName: choice.fallback,
          instructions: input.system,
        });
        collected = await collectTurn({
          sessionId: session.id,
          content,
          abortSignal: input.abortSignal,
          previousTurnId: "none",
        });
      }
      const failed = collected.chunks.some((chunk) => chunk.type === "error");
      for (const chunk of collected.chunks) {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      }
      writer.write({
        type: "finish",
        finishReason: failed ? "error" : "stop",
      });
    },
    onError: (error) =>
      error instanceof Error ? error.message : "The harness turn failed.",
  });
  return createUIMessageStreamResponse({ stream });
}
