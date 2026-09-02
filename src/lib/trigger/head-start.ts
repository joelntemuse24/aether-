import type { ChatClientData } from "./client-data";
import { sessionSafeChatClientData } from "./client-data";

/** First durable turn POSTs here so step 1 runs on the warm Next server. */
export const DURABLE_HEAD_START_PATH = "/api/chat/head-start";

/**
 * First-turn SSE stays open through tool handover. Long loops stay on the
 * durable agent — do not use the 300s request-path cap.
 * Route files must copy this as a numeric literal (`export const maxDuration = 60`):
 * Next.js segment config cannot be an imported identifier.
 */
export const HEAD_START_MAX_DURATION_SECONDS = 60;

export function splitHeadStartClientData(clientData: ChatClientData): {
  turnClientData: ChatClientData;
  sessionMetadata: ChatClientData;
} {
  return {
    turnClientData: clientData,
    sessionMetadata: sessionSafeChatClientData(clientData),
  };
}

export function applyHeadStartWireMetadata(
  wire: Record<string, unknown>,
  sessionMetadata: ChatClientData,
): Record<string, unknown> {
  return {
    ...wire,
    metadata: sessionMetadata,
  };
}
