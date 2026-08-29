import type { RankedModelOption } from "./rank-models";
import { isHermesConfigured } from "@/lib/hermes/config";

/**
 * Hosted chat runs on server OpenRouter / BUZZ keys.
 * A remote Hermes gateway is opt-in (`HERMES_ENABLED=1`) and not the default.
 */
export function isHostedChatAvailable(
  env: NodeJS.ProcessEnv = process.env,
  localHostedConfigured = false,
): boolean {
  return localHostedConfigured || isHermesConfigured(env);
}

export function hermesFallbackPickerModels(
  env: NodeJS.ProcessEnv = process.env,
): RankedModelOption[] {
  if (!isHermesConfigured(env)) return [];
  const id = env.HERMES_MODEL_NAME?.trim() || "hermes-agent";
  return [
    {
      id,
      label: "Aether Cloud",
      family: "other",
      description: "Hosted agent",
    },
  ];
}
