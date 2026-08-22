import type { RankedModelOption } from "./rank-models";
import { isHermesConfigured } from "@/lib/hermes/config";

/**
 * Hosted chat can run via local upstream keys (OpenRouter / BUZZ) OR a
 * remote Hermes gateway. The picker must treat either as "ready".
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
