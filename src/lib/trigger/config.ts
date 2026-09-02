/**
 * Trigger.dev chat.agent wiring (server + client feature flag).
 * Product UI never names the vendor — use chatTransport "durable" | "request".
 */

export const CHAT_AGENT_TASK_ID = "chat.agent";

export type ChatTransportMode = "durable" | "request";

export function isTriggerChatConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const secret = env.TRIGGER_SECRET_KEY?.trim() ?? "";
  const project = env.TRIGGER_PROJECT_ID?.trim() ?? "";
  return secret.length > 0 && project.length > 0;
}

export function resolveChatTransportMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ChatTransportMode {
  return isTriggerChatConfigured(env) ? "durable" : "request";
}

export function triggerProjectId(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const id = env.TRIGGER_PROJECT_ID?.trim();
  return id || null;
}
