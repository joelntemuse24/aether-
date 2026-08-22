import type { UIMessage } from "ai";
import { friendlyChatError } from "@/lib/chat-errors";
import {
  buildHermesSessionKey,
  getHermesConfig,
  type HermesConfig,
} from "./config";
import { streamHermesChatCompletions } from "./client";
import { toOpenAIChatMessages } from "./messages";
import { resolveHermesModelRequest } from "./provider";
import { extractHermesRunId, stopHermesRun } from "./stop";
import { bridgeHermesChatCompletionToUIMessageResponse } from "./stream-bridge";
import { runHermesAetherToolLoop } from "./tool-loop";
import type { AetherToolContext } from "./aether-tools";

export type ProxyChatToHermesArgs = {
  messages: UIMessage[];
  system?: string;
  /** Picker model id (preferred when Hermes honors per-request model) */
  model: string;
  userId: string | null;
  conversationId: string | null;
  runId?: string;
  abortSignal?: AbortSignal;
  accessMode?: "hosted" | "byok";
  /** BYOK provider header — used only to pick a Hermes provider slug */
  byokProvider?: string | null;
  /** Optional explicit provider slug (wins over resolver) */
  provider?: string;
  config?: HermesConfig;
  /** When set, Aether-owned tools execute on Vercel during this turn. */
  aetherTools?: AetherToolContext | null;
  onFinish?: (info: { completionId?: string }) => void;
  onError?: (error: unknown) => void;
};

/**
 * Forward a chat turn to remote Hermes and return a UIMessage stream
 * Response compatible with assistant-ui / useChat.
 */
export async function proxyChatToHermes(
  args: ProxyChatToHermesArgs,
): Promise<Response> {
  const config = args.config ?? getHermesConfig();
  if (!config) {
    return new Response(
      JSON.stringify({
        error:
          "Hermes is not configured. Set HERMES_BASE_URL and HERMES_API_KEY.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const openaiMessages = toOpenAIChatMessages(args.messages, args.system);
  if (openaiMessages.filter((m) => m.role !== "system").length === 0) {
    return new Response(
      JSON.stringify({ error: "No messages provided." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const sessionKey = buildHermesSessionKey({
    userId: args.userId,
    conversationId: args.conversationId,
  });

  const resolved = resolveHermesModelRequest({
    requestedModel: args.model || config.modelName,
    accessMode: args.accessMode ?? "hosted",
    byokProvider: args.byokProvider,
    defaultModelName: config.modelName,
  });
  const provider = args.provider || resolved.provider;

  let seenRunId: string | undefined;
  const noteRunId = (id: string | null | undefined) => {
    if (!id || seenRunId) return;
    seenRunId = id;
  };

  const abortSignal = args.abortSignal;
  const onAbortStop = () => {
    if (!seenRunId) return;
    void stopHermesRun({ config, runId: seenRunId });
  };
  abortSignal?.addEventListener("abort", onAbortStop, { once: true });

  const onStreamError = (error: unknown) => {
    args.onError?.(error);
    return friendlyChatError(error);
  };
  const onEnd = (info: {
    completionId?: string;
    aborted?: boolean;
    runId?: string;
  }) => {
    abortSignal?.removeEventListener("abort", onAbortStop);
    if (info.aborted) {
      noteRunId(info.runId);
      onAbortStop();
      return;
    }
    args.onFinish?.({ completionId: info.completionId });
  };

  if (args.aetherTools) {
    return runHermesAetherToolLoop({
      config,
      messages: openaiMessages,
      model: resolved.model,
      provider,
      sessionId: args.conversationId,
      sessionKey,
      idempotencyKey: args.runId,
      abortSignal,
      aether: args.aetherTools,
      onRunId: noteRunId,
      onError: onStreamError,
      onEnd,
    });
  }

  let upstream: Response;
  try {
    upstream = await streamHermesChatCompletions({
      config,
      body: {
        model: resolved.model,
        messages: openaiMessages,
        stream: true,
        ...(provider ? { provider } : {}),
      },
      sessionId: args.conversationId,
      sessionKey,
      idempotencyKey: args.runId,
      abortSignal,
    });
  } catch (error) {
    abortSignal?.removeEventListener("abort", onAbortStop);
    args.onError?.(error);
    if (abortSignal?.aborted) {
      onAbortStop();
      return new Response(null, { status: 499 });
    }
    console.error("[hermes] fetch failed", error);
    return new Response(
      JSON.stringify({
        error: friendlyChatError(error) || "Hermes gateway unreachable.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  noteRunId(extractHermesRunId({ headers: upstream.headers }));

  if (!upstream.ok || !upstream.body) {
    abortSignal?.removeEventListener("abort", onAbortStop);
    const detail = await upstream.text().catch(() => "");
    console.error(
      "[hermes] upstream error",
      upstream.status,
      detail.slice(0, 500),
    );
    args.onError?.(new Error(`Hermes ${upstream.status}`));
    const status =
      upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    return new Response(
      JSON.stringify({
        error:
          upstream.status === 401 || upstream.status === 403
            ? "Hermes rejected the server API key."
            : upstream.status === 429
              ? "Hermes is busy (too many concurrent runs). Try again shortly."
              : "Hermes gateway error. Try again, or ask the operator to check the agent host.",
      }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  return bridgeHermesChatCompletionToUIMessageResponse({
    body: upstream.body,
    abortSignal,
    onRunId: noteRunId,
    onError: onStreamError,
    onEnd,
  });
}
