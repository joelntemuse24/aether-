import type { HermesConfig } from "./config";
import { hermesChatCompletionsUrl } from "./config";
import type { OpenAIChatMessage } from "./messages";

export type HermesChatCompletionRequest = {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  provider?: string;
};

export type StreamHermesChatArgs = {
  config: HermesConfig;
  body: HermesChatCompletionRequest;
  sessionId: string | null;
  sessionKey: string;
  idempotencyKey?: string;
  abortSignal?: AbortSignal;
};

/**
 * POST /v1/chat/completions on the remote Hermes gateway.
 * Returns the raw Response (caller bridges the SSE body).
 */
export async function streamHermesChatCompletions(
  args: StreamHermesChatArgs,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.config.apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "X-Hermes-Session-Key": args.sessionKey,
  };
  if (args.sessionId) {
    headers["X-Hermes-Session-Id"] = args.sessionId.slice(0, 256);
  }
  if (args.idempotencyKey) {
    headers["Idempotency-Key"] = args.idempotencyKey.slice(0, 256);
  }

  const url = hermesChatCompletionsUrl(args.config.baseUrl);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...args.body,
      stream: args.body.stream !== false,
    }),
    signal: args.abortSignal,
  });

  return res;
}
