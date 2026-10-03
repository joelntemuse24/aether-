/**
 * Native engine switch.
 * `native` proxies /api/chat to the VM agent server.
 * `legacy` skips that proxy and the TrueForge sidecar.
 * Unset or `trueforge` keeps today's router.
 */

export const AGENT_ENGINE_VALUES = ["native", "trueforge", "legacy"] as const;

export type AgentEngineFlag = (typeof AGENT_ENGINE_VALUES)[number];

export type ChatEngine = "native" | "openrouter" | "trueforge" | "hermes" | "legacy";

export function readAgentEngineFlag(
  env: Record<string, string | undefined> = process.env,
): AgentEngineFlag | null {
  const raw = (env.AETHER_AGENT_ENGINE ?? "").trim().toLowerCase();
  if (raw === "native" || raw === "trueforge" || raw === "legacy") return raw;
  return null;
}

/**
 * `hostedOpenRouter` means the hosted OpenRouter model branch already has a key.
 * `trueforgeReachable` is only true when the caller probed the sidecar.
 * Pass `env` so tests do not read the process environment.
 */
export function selectChatEngine(input: {
  env?: Record<string, string | undefined>;
  hostedOpenRouter: boolean;
  trueforgeReachable: boolean;
  hermesLive: boolean;
}): ChatEngine {
  const flag = readAgentEngineFlag(input.env ?? process.env);
  if (flag === "native") return "native";
  if (input.hostedOpenRouter) return "openrouter";
  if (flag !== "legacy" && input.trueforgeReachable) return "trueforge";
  if (input.hermesLive) return "hermes";
  return "legacy";
}
