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
import {
  HOSTED_DEFAULT_MODEL_FQN,
  HOSTED_DEFAULT_MODEL_ID,
  HOSTED_DEFAULT_MODEL_LABEL,
  HOSTED_FREE_FALLBACK_MODEL_FQN,
  isHostedDefaultModel,
} from "@/lib/hosted/default-model";

/** Pause before the hosted default's single retry. The shared upstream pool needs seconds to free up. */
export const HOSTED_RETRY_DELAY_MS = 15_000;

const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests/i;

/** True when the hosted default is still rate limited after its delayed retry. */
export function shouldFailoverHostedTurn(input: {
  modelId: string;
  failedBeforeOutput: boolean;
  errorText: string;
  userAborted: boolean;
  attempt: number;
}): boolean {
  return (
    isHostedDefaultModel(input.modelId) &&
    !input.userAborted &&
    input.failedBeforeOutput &&
    input.attempt === 1 &&
    RATE_LIMIT_RE.test(input.errorText)
  );
}

/** Sidecar model name for a hosted model id. */
export function hostedModelFqn(modelId: string): string {
  return isHostedDefaultModel(modelId) ? HOSTED_DEFAULT_MODEL_FQN : buzzModelFqn(modelId);
}

/**
 * The hosted default gets exactly one retry for any failure before output
 * (rate limits included), then an honest error. Buzz keeps its transient-only rule.
 */
export function shouldRetryHostedTurn(input: {
  modelId: string;
  failedBeforeOutput: boolean;
  errorText: string;
  userAborted: boolean;
  attempt: number;
}): boolean {
  if (isHostedDefaultModel(input.modelId)) {
    return !input.userAborted && input.failedBeforeOutput && input.attempt === 0;
  }
  return shouldRetryBuzzTurn(input);
}

/** Only a Buzz turn may be backed up with the user's own OpenRouter key. */
export function shouldBackupHostedTurn(input: {
  modelId: string;
  failedBeforeOutput: boolean;
  userAborted: boolean;
  hasKey: boolean;
}): boolean {
  if (isHostedDefaultModel(input.modelId)) return false;
  return shouldBackupBuzzWithOpenRouter(input);
}

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

/** Stop a turn before the platform cuts it off with no answer. */
export const TURN_BUDGET_MS = 240_000;

export const CUT_OFF_ANSWER =
  "Stopped before this finished. The last command ran too long.";

/** Cut off while the model was still thinking or went quiet, with no command running. */
export const NO_ANSWER_CUT_OFF =
  "Stopped before an answer was ready. Use Retry to try again.";

/** A stream that sends nothing for this long, with no tool running, is treated as stalled. */
export const STREAM_IDLE_MS = 90_000;

/** Close a command the turn had to abandon, and keep any answer already written. */
export function settleCutOffChunks(input: {
  sawText: boolean;
  openTools: { id: string; name: string }[];
}): UiChunk[] {
  const chunks: UiChunk[] = [];
  for (const tool of input.openTools) {
    if (!tool.id) continue;
    chunks.push({
      type: "tool-output-available",
      toolCallId: tool.id,
      output: { ok: false, error: "The command timed out. Try a smaller step." },
      providerExecuted: true,
    });
  }
  if (!input.sawText) {
    const answer = input.openTools.some((tool) => tool.id) ? CUT_OFF_ANSWER : NO_ANSWER_CUT_OFF;
    chunks.push({ type: "text-start", id: "tf-cutoff" });
    chunks.push({ type: "text-delta", id: "tf-cutoff", delta: answer });
    chunks.push({ type: "text-end", id: "tf-cutoff" });
  }
  return chunks;
}

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
  /** True when this process stopped the turn before the platform time limit. */
  cutoff?: () => boolean;
}): Promise<{ failedBeforeOutput: boolean; wroteError: boolean; errorText: string }> {
  const state = createTrueForgeUiState();
  let sawContent = false;
  let sawText = false;
  let failed = false;
  let errorText = "";
  let turnId = "";
  // The hosted default keeps a streamed answer and drops the busy error. Other models still show theirs.
  const keepsPartialAnswer = () => sawText && isHostedDefaultModel(input.modelId ?? "");
  const emit = (chunk: UiChunk) => {
    if (chunk.type === "text-delta") sawText = true;
    if (CONTENT_TYPES.has(String(chunk.type))) sawContent = true;
    if (chunk.type === "error") {
      failed = true;
      const raw = String(chunk.errorText ?? "");
      if (raw) errorText = raw;
      if (!sawContent || keepsPartialAnswer()) return;
      input.write({
        ...chunk,
        errorText: hostedTurnErrorCopy(raw || errorText, input.modelId ?? ""),
      });
      return;
    }
    input.write(chunk);
  };
  const settle = () => {
    for (const chunk of settleCutOffChunks({
      sawText,
      openTools: [...state.openTools.entries()].map(([id, name]) => ({ id, name })),
    })) {
      emit(chunk);
    }
  };
  // Tools still open after the turn ended would leave the client waiting. The answer text stays.
  const settleOpenTools = () => {
    const openTools = [...state.openTools.entries()].map(([id, name]) => ({ id, name }));
    for (const chunk of settleCutOffChunks({ sawText: true, openTools })) emit(chunk);
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
      if ((event.type === "tool.approval_required" || event.type === "tool.response_required") && Array.isArray(event.toolCalls)) {
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
                threadId: String(event.threadId ?? event.thread_id ?? ""),
                kind: event.type === "tool.response_required" ? "response" : "approval",
                toolCallId: String(row.id ?? ""),
              }),
            };
          }),
        };
      }
      for (const chunk of chunksForTrueForgeEvent(payload, state)) emit(chunk);
    }
  } catch (error) {
    if (input.cutoff?.()) {
      await emitSandboxFiles();
      settle();
      for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
      return { failedBeforeOutput: false, wroteError: false, errorText: "" };
    }
    const message = error instanceof Error ? error.message : "The harness turn failed.";
    await emitSandboxFiles();
    if (!sawContent) return { failedBeforeOutput: true, wroteError: false, errorText: message };
    for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
    settleOpenTools();
    if (!keepsPartialAnswer()) {
      input.write({ type: "error", errorText: hostedTurnErrorCopy(message, input.modelId ?? "") });
    }
    return { failedBeforeOutput: false, wroteError: true, errorText: message };
  }
  await emitSandboxFiles();
  if (input.cutoff?.()) {
    settle();
    for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
    return { failedBeforeOutput: false, wroteError: false, errorText: "" };
  }
  if (failed && !sawContent) return { failedBeforeOutput: true, wroteError: false, errorText };
  for (const chunk of closeTrueForgeUi(state)) input.write(chunk);
  if (failed) settleOpenTools();
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
  cutoff?: () => boolean;
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
      cutoff: input.cutoff,
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
  if (isHostedDefaultModel(modelId)) {
    if (RATE_LIMIT_RE.test(message)) {
      return `${HOSTED_DEFAULT_MODEL_LABEL} is busy right now. Wait a minute, then use Retry.`;
    }
    if (/timed out|time limit|\btimeout\b|aborted/i.test(message)) {
      return `${HOSTED_DEFAULT_MODEL_LABEL} timed out. Use Retry to try this turn again.`;
    }
    return `${HOSTED_DEFAULT_MODEL_LABEL} didn't answer. Use Retry to try this turn again.`;
  }
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
  timeZone?: string | null;
  history?: { role: "user" | "assistant"; content: string }[];
}): Promise<Response> {
  const conversationId = resolveHostedConversationId(input.conversationId);
  const instructions = trueforgeInstructions(input.system, new Date(), {
    timeZone: input.timeZone,
  });
  const modelId = input.modelId || HOSTED_DEFAULT_MODEL_ID;
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const write = (chunk: UiChunk) => {
        writer.write(chunk as Parameters<typeof writer.write>[0]);
      };
      writer.write({ type: "start" });
      const session = await trueforgeSessionId({
        conversationId,
        owner: input.owner,
        modelName: hostedModelFqn(modelId),
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
      // Attempt 0, one delayed retry, then one free-model failover for a rate-limited default.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (input.abortSignal?.aborted) break;
        const controller = new AbortController();
        const onUserAbort = () => controller.abort();
        input.abortSignal?.addEventListener("abort", onUserAbort);
        const timer = setTimeout(() => controller.abort(), FIRST_BYTE_MS);
        let cutoff = false;
        const budget = setTimeout(() => {
          cutoff = true;
          controller.abort();
        }, TURN_BUDGET_MS);
        let sawByte = false;
        let openTools = 0;
        let idle: ReturnType<typeof setTimeout> | undefined;
        const armIdle = () => {
          clearTimeout(idle);
          if (openTools > 0) return;
          idle = setTimeout(() => {
            cutoff = true;
            controller.abort();
          }, STREAM_IDLE_MS);
        };
        const guardedWrite = (chunk: UiChunk) => {
          if (chunk.type === "tool-input-available") openTools++;
          if (chunk.type === "tool-output-available") openTools = Math.max(0, openTools - 1);
          if (isTurnActivityChunk(chunk)) {
            sawByte = true;
            clearTimeout(timer);
            armIdle();
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
            cutoff: () => cutoff,
          });
          outcome = result;
          if (attempt === 0) retryFrom = result.retryFrom;
        } finally {
          clearTimeout(timer);
          clearTimeout(budget);
          clearTimeout(idle);
          input.abortSignal?.removeEventListener("abort", onUserAbort);
        }
        if (cutoff) {
          // Closing the stream leaves the sidecar turn running, which blocks the next send.
          await cancelSidecarTurn(session.id);
          break;
        }
        if (sawByte || !outcome.failedBeforeOutput) break;
        if (input.abortSignal?.aborted) break;
        const next = {
          modelId,
          failedBeforeOutput: true,
          errorText: outcome.errorText || "aborted",
          userAborted: false,
          attempt,
        };
        if (shouldFailoverHostedTurn(next)) {
          await cancelSidecarTurn(session.id);
          // Same session and tools, free hosted model. Later sends start on the default again.
          await trueforgeSessionId({
            conversationId,
            owner: input.owner,
            modelName: HOSTED_FREE_FALLBACK_MODEL_FQN,
            instructions,
            toolContext: input.toolContext,
          });
          continue;
        }
        if (!shouldRetryHostedTurn(next)) break;
        await cancelSidecarTurn(session.id);
        if (isHostedDefaultModel(modelId)) await new Promise((resolve) => setTimeout(resolve, HOSTED_RETRY_DELAY_MS));
      }
      input.abortSignal?.removeEventListener("abort", onClientStop);
      const openRouterKey = input.openRouterKey?.trim() ?? "";
      if (
        shouldBackupHostedTurn({
          modelId,
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
          statusLine: "The first model failed, answering with a backup model.",
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
