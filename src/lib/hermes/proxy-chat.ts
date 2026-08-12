import type { UIMessage } from "ai";
import { friendlyChatError } from "@/lib/chat-errors";
import {
  buildHermesSessionKey,
  getHermesConfig,
  type HermesConfig,
} from "./config";
import { streamHermesChatCompletions } from "./client";
import { toOpenAIChatMessages } from "./messages";
import { bridgeHermesChatCompletionToUIMessageResponse } from "./stream-bridge";

export type ProxyChatToHermesArgs = {
  messages: UIMessage[];
  system?: string;
  /** Picker model id (preferred when Hermes honors per-request model) */
  model: string;
  userId: string | null;
  conversationId: string | null;
  runId?: string;
  abortSignal?: AbortSignal;
  /** Optional OpenRouter-style provider slug for Hermes direct routing */
  provider?: string;
  config?: HermesConfig;
  onFinish?: (info: { completionId?: string }) => void;
  onError?: (error: unknown) => void;
};

/**
 * Forward a hosted chat turn to remote Hermes and return a UIMessage stream
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

  let upstream: Response;
  try {
    upstream = await streamHermesChatCompletions({
      config,
      body: {
        model: args.model || config.modelName,
        messages: openaiMessages,
        stream: true,
        ...(args.provider ? { provider: args.provider } : {}),
      },
      sessionId: args.conversationId,
      sessionKey,
      idempotencyKey: args.runId,
      abortSignal: args.abortSignal,
    });
  } catch (error) {
    args.onError?.(error);
    if (args.abortSignal?.aborted) {
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

  if (!upstream.ok || !upstream.body) {
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
    abortSignal: args.abortSignal,
    onError: (error) => {
      args.onError?.(error);
      return friendlyChatError(error);
    },
    onEnd: (info) => {
      if (!info.aborted) {
        args.onFinish?.({ completionId: info.completionId });
      }
    },
  });
}
