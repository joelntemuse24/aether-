/**
 * Native engine switch. Unset or unrecognised leaves the current chat path.
 * The route does not read this yet; later PRs branch on it.
 */

export const AGENT_ENGINE_VALUES = ["native", "trueforge", "legacy"] as const;

export type AgentEngineFlag = (typeof AGENT_ENGINE_VALUES)[number];

export function readAgentEngineFlag(
  env: Record<string, string | undefined> = process.env,
): AgentEngineFlag | null {
  const raw = (env.AETHER_AGENT_ENGINE ?? "").trim().toLowerCase();
  if (raw === "native" || raw === "trueforge" || raw === "legacy") return raw;
  return null;
}
