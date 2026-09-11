/**
 * Thin optional MCP hook. A marketplace / dynamic tool catalog is out of
 * scope — this only reports whether an operator pointed at one server URL.
 */

export type OptionalMcpStatus = {
  enabled: boolean;
  available: boolean;
  url?: string;
  reason: string;
};

export function optionalMcpStatus(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): OptionalMcpStatus {
  const enabled = (env.AETHER_MCP_ENABLED || "").trim() === "1";
  const url = (env.AETHER_MCP_URL || "").trim();
  if (!enabled || !url) {
    return {
      enabled: false,
      available: false,
      reason:
        "Optional tool servers are off. A full marketplace is not included.",
    };
  }
  return {
    enabled: true,
    available: true,
    url,
    reason: "A single optional tool-server URL is configured. No marketplace.",
  };
}
