/**
 * Session PAT helpers for the durable chat transport.
 *
 * Trigger appends to `/sessions/{chatId}/in/append` using useChat's id.
 * The start-session externalId and mint-token scopes MUST use that same
 * chatId. Substituting assistant-ui's remoteId is the production 403:
 * `appendToSessionStream failed: 403` / unauthorized access_token.
 */

export function triggerSessionChatId(transportChatId: string): string {
  const id = transportChatId.trim();
  if (!id) {
    throw new Error("chatId is required.");
  }
  return id;
}

export function buildStartSessionRequest(input: {
  transportChatId: string;
  threadRemoteId?: string;
  clientData: Record<string, unknown>;
}): {
  chatId: string;
  clientData: Record<string, unknown> & { conversationId: string };
} {
  const chatId = triggerSessionChatId(input.transportChatId);
  const fromClient =
    typeof input.clientData.conversationId === "string"
      ? input.clientData.conversationId.trim()
      : "";
  const conversationId = input.threadRemoteId?.trim() || fromClient || chatId;
  return {
    chatId,
    clientData: {
      ...input.clientData,
      conversationId,
    },
  };
}

function looksLikeJwt(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("eyJ") && trimmed.split(".").length >= 3;
}

function jwtFromUnknown(value: unknown): string {
  if (typeof value === "string" && looksLikeJwt(value)) return value.trim();
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const inner = rec.publicAccessToken ?? rec.token;
    if (typeof inner === "string" && looksLikeJwt(inner)) return inner.trim();
  }
  throw new Error("Could not start chat.");
}

/** Normalize auth.createPublicToken's return into a JWT string. */
export function publicTokenToJwt(token: unknown): string {
  return jwtFromUnknown(token);
}

/** accessToken callback: mint-token is text/plain JWT, but accept JSON too. */
export function parseMintedAccessToken(body: string): string {
  const trimmed = body.trim();
  if (!trimmed || trimmed === "[object Object]") {
    throw new Error("Could not start chat.");
  }
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Could not start chat.");
    }
    return jwtFromUnknown(parsed);
  }
  return jwtFromUnknown(trimmed);
}

export function parseStartSessionResult(json: unknown): { publicAccessToken: string } {
  return { publicAccessToken: jwtFromUnknown(json) };
}
