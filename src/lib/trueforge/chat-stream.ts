import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { IncomingAttachment } from "@/lib/chat-turn";
import { encodeTrueForgeApproval } from "./approvals";
import { trueforgeInstructions } from "./instructions";
import {
  trueforgeClient,
  trueforgeModelChoice,
  trueforgeSessionId,
  switchTrueForgeSessionModel,
} from "./sessions";
import type { TrueForgeToolContext } from "./tool-context";
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

type TurnEvent = { type?: string; [key: string]: unknown };

const CONTENT_TYPES = new Set(["text-delta", "tool-input-available", "reasoning-delta"]);

export async function driveTrueForgeTurn(input: {
  events: AsyncIterable<TurnEvent>;
  write: (chunk: UiChunk) => void;
  sessionId: string;
}): Promise<{ failedBeforeOutput: boolean; wroteError: boolean }> {
  const state = createTrueForgeUiState();
  let sawContent = false;
  let failed = false;
  const emit = (chunk: UiChunk) => {
    if (CONTENT_TYPES.has(String(chunk.type))) sawContent = true;
    if (chunk.type === "error") {
      failed = true;
      if (!sawContent) return;
    }
    input.write(chunk);
  };
  try {
    for await (const event of input.events) {
      let payload = event;
      if (event.type === "tool.approval_required" && Array.isArray(event.toolCalls)) {
        payload = {
          ...event,
          sessionId: input.sessionId,
          toolCalls: event.toolCalls.map((call) => {
            if (!call || typeof call !== "object") return call;
            const row = call as { id?: string };
            return {
              ...row,
              confirmationId: encodeTrueForgeApproval({
                sessionId: input.sessionId,
                threadId: String(event.threadId ?? ""),
                toolCallId: String(row.id ?? ""),
              }),
            };
          }),
        };
      }
      for (const chunk of chunksForTrueForgeEvent(payload, state)) emit(chunk);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The harness turn failed.";
    if (!sawContent) return { failedBeforeOutput: true, wroteError: false };
    input.write({ type: "error", errorText: message });
    for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
    return { failedBeforeOutput: false, wroteError: true };
  }
  if (failed && !sawContent) return { failedBeforeOutput: true, wroteError: false };
  for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
  return { failedBeforeOutput: false, wroteError: failed };
}

async function runTurn(input: {
  sessionId: string;
  content: ReturnType<typeof buildTrueForgeUserContent>;
  abortSignal?: AbortSignal;
  previousTurnId?: "auto" | "none";
  write: (chunk: UiChunk) => void;
}): Promise<{ failedBeforeOutput: boolean; wroteError: boolean }> {
  try {
    const turn = await trueforgeClient().sessions.createTurnStream(
      input.sessionId,
      {
        input: [{ type: "user.message", content: input.content }],
        previousTurnId: input.previousTurnId ?? "auto",
      },
      { abortSignal: input.abortSignal },
    );
    return driveTrueForgeTurn({
      events: turn as AsyncIterable<TurnEvent>,
      write: input.write,
      sessionId: input.sessionId,
    });
  } catch {
    return { failedBeforeOutput: true, wroteError: false };
  }
}

export async function streamTrueForgeHostedChat(input: {
  conversationId: string | null;
  userText: string;
  system: string;
  attachments?: IncomingAttachment[];
  abortSignal?: AbortSignal;
  toolContext?: Omit<TrueForgeToolContext, "exp"> | null;
}): Promise<Response> {
  const conversationId = input.conversationId || `guest-${crypto.randomUUID()}`;
  const instructions = trueforgeInstructions(input.system);
  const content = buildTrueForgeUserContent(input.userText || "", input.attachments ?? []);
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UiChunk) => {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      };
      writer.write({ type: "start" });
      const choice = await trueforgeModelChoice();
      const session = await trueforgeSessionId({
        conversationId,
        modelName: choice.primary,
        instructions,
        toolContext: input.toolContext,
      });
      let outcome = await runTurn({
        sessionId: session.id,
        content,
        abortSignal: input.abortSignal,
        write,
      });
      if (
        shouldFailoverTrueForgeTurn({
          failedBeforeOutput: outcome.failedBeforeOutput,
          fallback: choice.fallback,
          usedFallback: session.model === choice.fallback,
        }) &&
        choice.fallback
      ) {
        await switchTrueForgeSessionModel({
          conversationId,
          sessionId: session.id,
          modelName: choice.fallback,
          instructions,
          mcpName: session.mcpKey ? session.mcpKey.split(":")[0] : null,
        });
        outcome = await runTurn({
          sessionId: session.id,
          content,
          abortSignal: input.abortSignal,
          previousTurnId: "none",
          write,
        });
      }
      if (outcome.failedBeforeOutput) {
        write({ type: "error", errorText: "The model did not respond." });
      }
      writer.write({
        type: "finish",
        finishReason: outcome.wroteError || outcome.failedBeforeOutput ? "error" : "stop",
      });
    },
    onError: (error) =>
      error instanceof Error ? error.message : "The harness turn failed.",
  });
  return createUIMessageStreamResponse({ stream });
}
