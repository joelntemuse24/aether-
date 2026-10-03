import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { IncomingAttachment } from "@/lib/chat-turn";
import { buzzModelFqn, buzzModelUnavailableCopy, isBuzzModelUnavailableError } from "@/lib/buzz/models";
import { encodeTrueForgeApproval } from "./approvals";
import { browserSafeChatError } from "./hosted-limit";
import { TOOLS_UNAVAILABLE_NOTICE, trueforgeInstructions } from "./instructions";
import { trueforgeClient, trueforgeSessionId } from "./sessions";
import type { TrueForgeToolContext } from "./tool-context";
import { sandboxFileCards, type SandboxFileRef } from "./sandbox-files";
import {
  chunksForTrueForgeEvent,
  closeTrueForgeUi,
  createTrueForgeUiState,
  flushSandboxHold,
  type UiChunk,
} from "./ui-chunks";
import { planHostedTurnResume, resolveHostedConversationId } from "./conversation-continuity";
import { buildTrueForgeUserContent } from "./user-content";
import { openRouterFallbackModel, redactSecret } from "@/lib/openrouter/models";
import { shouldBackupBuzzWithOpenRouter, writeOpenRouterAnswer } from "@/lib/openrouter/stream";

export function shouldRetryBuzzTurn(input: {
  failedBeforeOutput: boolean;
  errorText: string;
  userAborted: boolean;
  attempt: number;
}): boolean {
  if (input.userAborted || !input.failedBeforeOutput || input.attempt > 0) return false;
  if (/model_not_found|not enabled for group/i.test(input.errorText)) return false;
  return /525|cloudflare|\b5\d\d\b|network|fetch failed|econn|socket|aborted/i.test(input.errorText);
}

type TurnEvent = { type?: string; [key: string]: unknown };

const CONTENT_TYPES = new Set(["text-delta", "tool-input-available", "reasoning-delta"]);

export async function driveTrueForgeTurn(input: {
  events: AsyncIterable<TurnEvent>;
  write: (chunk: UiChunk) => void;
  sessionId: string;
  modelId?: string;
  /** Loads sandbox bytes for a path the model listed. Tests pass a stub. */
  loadSandboxFile?: (filePath: string, turnId: string) => Promise<Uint8Array | Buffer | null>;
  persistSandboxFile?: (file: {
    title: string;
    filename: string;
    mime: string;
    dataUrl: string;
  }) => Promise<{ id?: string; persisted: boolean }>;
}): Promise<{ failedBeforeOutput: boolean; wroteError: boolean; errorText: string }> {
  const state = createTrueForgeUiState();
  let sawContent = false;
  let failed = false;
  let errorText = "";
  let turnId = "";
  const emit = (chunk: UiChunk) => {
    if (CONTENT_TYPES.has(String(chunk.type))) sawContent = true;
    if (chunk.type === "error") {
      failed = true;
      const raw = String(chunk.errorText ?? "");
      if (raw) errorText = raw;
      if (!sawContent) return;
      input.write({
        ...chunk,
        errorText: hostedTurnErrorCopy(raw || errorText, input.modelId ?? ""),
      });
      return;
    }
    input.write(chunk);
  };
  const emitSandboxFiles = async () => {
    for (const chunk of flushSandboxHold(state)) emit(chunk);
    if (!turnId || state.sandboxFiles.length === 0) return;
    const refs: SandboxFileRef[] = state.sandboxFiles.splice(0, state.sandboxFiles.length);
    const load =
      input.loadSandboxFile ??
      ((filePath: string) => downloadHostedSandboxFile(input.sessionId, turnId, filePath));
    try {
      const cards = await sandboxFileCards({
        refs,
        load: (filePath) => load(filePath, turnId),
        persist: input.persistSandboxFile,
      });
      for (const chunk of cards) emit(chunk);
    } catch {
      // The private path is already hidden. Skip a card we could not build.
    }
  };
  try {
    for await (const event of input.events) {
      if (event.type === "turn.created") {
        const id = event.turnId ?? event.turn_id;
        if (typeof id === "string" && id) turnId = id;
      }
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
    await emitSandboxFiles();
    if (!sawContent) return { failedBeforeOutput: true, wroteError: false, errorText: message };
    input.write({ type: "error", errorText: hostedTurnErrorCopy(message, input.modelId ?? "") });
    for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
    return { failedBeforeOutput: false, wroteError: true, errorText: message };
  }
  await emitSandboxFiles();
  if (failed && !sawContent) return { failedBeforeOutput: true, wroteError: false, errorText };
  for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
  return { failedBeforeOutput: false, wroteError: failed, errorText };
}

async function persistSandboxDownload(
  owner: { userId?: string | null; conversationId?: string | null; projectId?: string | null },
  file: { title: string; filename: string; mime: string; dataUrl: string },
): Promise<{ id?: string; persisted: boolean }> {
  if (!owner.userId) return { persisted: false };
  const { isCloudDbConfigured } = await import("@/lib/db");
  if (!isCloudDbConfigured()) return { persisted: false };
  const { saveArtifact } = await import("@/lib/artifacts/store");
  try {
    const saved = await saveArtifact(owner.userId, {
      kind: "file",
      title: file.title,
      language: file.filename,
      content: file.dataUrl,
      conversationId: owner.conversationId ?? undefined,
      projectId: owner.projectId ?? undefined,
      producedBy: ["sandbox"],
    });
    return { id: saved.id, persisted: true };
  } catch {
    return { persisted: false };
  }
}

async function downloadHostedSandboxFile(
  sessionId: string,
  turnId: string,
  filePath: string,
): Promise<Buffer | null> {
  const response = await trueforgeClient().sessions.downloadSandboxFile(sessionId, turnId, {
    path: filePath,
  });
  return Buffer.from(await response.arrayBuffer());
}

/** Retry forks from the failed turn's parent. `none` would start a new root and drop history. */
export function retryPreviousTurnId(
  created: { previousTurnId: string | null } | null,
): "auto" | "none" | string {
  if (!created) return "auto";
  return created.previousTurnId ?? "none";
}

function turnParentId(event: TurnEvent): string | null {
  const value = event.previousTurnId ?? event.previous_turn_id;
  return typeof value === "string" && value ? value : null;
}

async function runTurn(input: {
  sessionId: string;
  content: ReturnType<typeof buildTrueForgeUserContent>;
  abortSignal?: AbortSignal;
  previousTurnId?: "auto" | "none" | string;
  write: (chunk: UiChunk) => void;
  modelId?: string;
  loadSandboxFile?: (filePath: string, turnId: string) => Promise<Uint8Array | Buffer | null>;
  persistSandboxFile?: (file: {
    title: string;
    filename: string;
    mime: string;
    dataUrl: string;
  }) => Promise<{ id?: string; persisted: boolean }>;
}): Promise<{
  failedBeforeOutput: boolean;
  wroteError: boolean;
  errorText: string;
  retryFrom: "auto" | "none" | string;
}> {
  let created: { previousTurnId: string | null } | null = null;
  try {
    const turn = await trueforgeClient().sessions.createTurnStream(
      input.sessionId,
      {
        input: [{ type: "user.message", content: input.content }],
        previousTurnId: input.previousTurnId ?? "auto",
      },
      { abortSignal: input.abortSignal },
    );
    async function* tagged() {
      for await (const event of turn as AsyncIterable<TurnEvent>) {
        if (event.type === "turn.created") {
          created = { previousTurnId: turnParentId(event) };
        }
        yield event;
      }
    }
    const outcome = await driveTrueForgeTurn({
      events: tagged(),
      write: input.write,
      sessionId: input.sessionId,
      modelId: input.modelId,
      loadSandboxFile: input.loadSandboxFile,
      persistSandboxFile: input.persistSandboxFile,
    });
    return { ...outcome, retryFrom: retryPreviousTurnId(created) };
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "The model didn't respond.";
    return { failedBeforeOutput: true, wroteError: false, errorText, retryFrom: retryPreviousTurnId(created) };
  }
}

/** GPT first calls often take 12–25s. 45s avoids restarting a turn that is still working. */
export const FIRST_BYTE_MS = 45_000;

const ACTIVITY_CHUNK_TYPES = new Set([
  "text-delta",
  "reasoning-delta",
  "tool-input-available",
  "tool-output-available",
]);

export function isTurnActivityChunk(chunk: UiChunk): boolean {
  return ACTIVITY_CHUNK_TYPES.has(String(chunk.type));
}

/** Short copy for the existing error chunk. Keeps the model-unavailable sentence. */
export function hostedTurnErrorCopy(message: string, modelId: string): string {
  if (isBuzzModelUnavailableError(message)) return buzzModelUnavailableCopy(modelId);
  if (/timed out|time limit|\btimeout\b|aborted/i.test(message)) {
    return "The provider timed out. Use Retry to try this turn again.";
  }
  if (/\b400\b|rejected|invalid request|not supported/i.test(message)) {
    return "The provider rejected the request. Use Retry or pick another model.";
  }
  if (/overload|unavailable|\b429\b|\b52[05]\b|\b502\b|\b503\b|\b504\b|\b5\d\d\b/i.test(message)) {
    return "The provider had an error or is overloaded. Use Retry to try this turn again.";
  }
  return "The provider had an error. Use Retry to try this turn again.";
}

async function cancelSidecarTurn(sessionId: string): Promise<void> {
  try {
    await trueforgeClient().sessions.cancel(sessionId);
  } catch {
    // The turn may already be finished.
  }
}

export async function streamTrueForgeHostedChat(input: {
  conversationId: string | null;
  owner: string;
  userText: string;
  system: string;
  attachments?: IncomingAttachment[];
  abortSignal?: AbortSignal;
  toolContext?: Omit<TrueForgeToolContext, "exp"> | null;
  modelId?: string | null;
  openRouterKey?: string | null;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<Response> {
  const conversationId = resolveHostedConversationId(input.conversationId);
  const instructions = trueforgeInstructions(input.system);
  const modelId = input.modelId || "gpt-5.6-luna";
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UiChunk) => {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      };
      writer.write({ type: "start" });
      const session = await trueforgeSessionId({
        conversationId,
        owner: input.owner,
        modelName: buzzModelFqn(modelId),
        instructions,
        toolContext: input.toolContext,
      });
      const resumed = planHostedTurnResume({
        conversationId,
        userText: input.userText || "",
        history: input.history,
        sessionIsNew: session.created,
      });
      const content = buildTrueForgeUserContent(resumed.userText, input.attachments ?? []);
      if (session.toolsAttached === false) {
        write({ type: "text-start", id: "tf-no-tools" });
        write({ type: "text-delta", id: "tf-no-tools", delta: TOOLS_UNAVAILABLE_NOTICE });
        write({ type: "text-end", id: "tf-no-tools" });
      }
      let outcome = {
        failedBeforeOutput: true,
        wroteError: false,
        errorText: "",
      };
      let retryFrom: "auto" | "none" | string = "auto";
      // Closing the SSE stream does not freeze the turn. The next send then
      // hits PreviousTurnRunningError until sessions.cancel runs.
      const onClientStop = () => {
        void cancelSidecarTurn(session.id);
      };
      input.abortSignal?.addEventListener("abort", onClientStop);
      for (let attempt = 0; attempt < 2; attempt++) {
        if (input.abortSignal?.aborted) break;
        const controller = new AbortController();
        const onUserAbort = () => controller.abort();
        input.abortSignal?.addEventListener("abort", onUserAbort);
        const timer = setTimeout(() => controller.abort(), FIRST_BYTE_MS);
        let sawByte = false;
        const guardedWrite = (chunk: UiChunk) => {
          if (isTurnActivityChunk(chunk)) {
            sawByte = true;
            clearTimeout(timer);
          }
          write(chunk);
        };
        try {
          const result = await runTurn({
            sessionId: session.id,
            content,
            abortSignal: controller.signal,
            previousTurnId: attempt === 0 ? "auto" : retryFrom,
            write: guardedWrite,
            modelId,
            persistSandboxFile: input.toolContext?.userId
              ? (file) =>
                  persistSandboxDownload(
                    {
                      userId: input.toolContext?.userId,
                      conversationId,
                      projectId: input.toolContext?.projectId,
                    },
                    file,
                  )
              : undefined,
          });
          outcome = result;
          if (attempt === 0) retryFrom = result.retryFrom;
        } finally {
          clearTimeout(timer);
          input.abortSignal?.removeEventListener("abort", onUserAbort);
        }
        if (sawByte || !outcome.failedBeforeOutput) break;
        if (input.abortSignal?.aborted) break;
        if (
          !shouldRetryBuzzTurn({
            failedBeforeOutput: true,
            errorText: outcome.errorText || "aborted",
            userAborted: false,
            attempt,
          })
        ) {
          break;
        }
        await cancelSidecarTurn(session.id);
      }
      input.abortSignal?.removeEventListener("abort", onClientStop);
      const openRouterKey = input.openRouterKey?.trim() ?? "";
      if (
        shouldBackupBuzzWithOpenRouter({
          failedBeforeOutput: outcome.failedBeforeOutput,
          userAborted: !!input.abortSignal?.aborted,
          hasKey: !!openRouterKey,
        })
      ) {
        const backup = await writeOpenRouterAnswer({
          apiKey: openRouterKey,
          model: openRouterFallbackModel(modelId),
          system: input.system,
          userText: input.userText,
          history: input.history,
          write,
          abortSignal: input.abortSignal,
          statusLine: "Buzz failed, answering via OpenRouter.",
        });
        if (!backup.ok) {
          write({
            type: "error",
            errorText: hostedTurnErrorCopy(redactSecret(backup.errorText, openRouterKey), modelId),
          });
        }
      } else if (outcome.failedBeforeOutput && !input.abortSignal?.aborted) {
        write({ type: "error", errorText: hostedTurnErrorCopy(outcome.errorText, modelId) });
      }
      writer.write({
        type: "finish",
        finishReason: outcome.wroteError || outcome.failedBeforeOutput ? "error" : "stop",
      });
    },
    onError: (error) => browserSafeChatError(error).error,
  });
  return createUIMessageStreamResponse({ stream });
}
