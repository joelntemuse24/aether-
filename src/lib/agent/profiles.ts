/**
 * Agent-facing model profile. Token limits and reasoning efforts come from
 * `modelProfile`. Family quirks live here so Buzz settings stay unchanged.
 */

import { buzzAgentFamily } from "@/lib/buzz/models";
import {
  modelProfile,
  type ModelProfile,
  type ReasoningEffort,
} from "@/lib/trueforge/providers";

export type AgentFamily =
  | "gpt"
  | "claude"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "qwen"
  | "unknown";

export type AgentModelProfile = ModelProfile & {
  family: AgentFamily;
  parallelToolCalls: boolean;
  strictSchemas: boolean;
  vision: boolean;
  /**
   * Provider field for the chosen effort. Null when the family must not be
   * sent a reasoning effort (empty lists crash Claude on Buzz).
   */
  reasoningEffortParam: "reasoningEffort" | null;
  reasoningEffortToSend?: ReasoningEffort;
  recommendedMaxTools: number;
  simplifySchemas: boolean;
  quirks: readonly string[];
};

const FAMILY_FLAGS: Record<
  AgentFamily,
  Pick<
    AgentModelProfile,
    "parallelToolCalls" | "strictSchemas" | "vision" | "recommendedMaxTools" | "simplifySchemas" | "quirks"
  >
> = {
  gpt: {
    parallelToolCalls: true,
    strictSchemas: true,
    vision: true,
    recommendedMaxTools: 16,
    simplifySchemas: false,
    quirks: [],
  },
  claude: {
    parallelToolCalls: true,
    strictSchemas: false,
    vision: true,
    recommendedMaxTools: 16,
    simplifySchemas: false,
    quirks: [],
  },
  gemini: {
    parallelToolCalls: true,
    strictSchemas: false,
    vision: true,
    recommendedMaxTools: 12,
    simplifySchemas: true,
    quirks: [],
  },
  deepseek: {
    parallelToolCalls: false,
    strictSchemas: false,
    vision: false,
    recommendedMaxTools: 8,
    simplifySchemas: true,
    quirks: ["leaked-dsml"],
  },
  kimi: {
    parallelToolCalls: true,
    strictSchemas: false,
    vision: true,
    recommendedMaxTools: 8,
    simplifySchemas: true,
    quirks: [],
  },
  qwen: {
    parallelToolCalls: true,
    strictSchemas: false,
    vision: true,
    recommendedMaxTools: 8,
    simplifySchemas: true,
    quirks: [],
  },
  unknown: {
    parallelToolCalls: false,
    strictSchemas: false,
    vision: false,
    recommendedMaxTools: 4,
    simplifySchemas: true,
    quirks: [],
  },
};

function bareId(id: string): string {
  return (id.split("/").pop() ?? id).trim().toLowerCase();
}

export function agentFamily(modelId: string): AgentFamily {
  const buzz = buzzAgentFamily(modelId);
  if (buzz) return buzz;
  const bare = bareId(modelId);
  if (bare.includes("gemini")) return "gemini";
  if (bare.includes("deepseek")) return "deepseek";
  if (bare.includes("kimi") || bare.includes("moonshot")) return "kimi";
  if (bare.includes("qwen")) return "qwen";
  if (bare.includes("claude")) return "claude";
  if (bare.includes("gpt")) return "gpt";
  return "unknown";
}

export function agentModelProfile(modelId: string): AgentModelProfile {
  const base = modelProfile(modelId);
  const family = agentFamily(modelId);
  const flags = FAMILY_FLAGS[family];
  const effort = base.reasoningEffort;
  const canSend =
    !!effort && base.reasoningEfforts.length > 0 && base.reasoningEfforts.includes(effort);
  return {
    ...base,
    ...flags,
    family,
    reasoningEffortParam: canSend ? "reasoningEffort" : null,
    ...(canSend ? { reasoningEffortToSend: effort } : {}),
  };
}

/**
 * Options for `streamText`. Omits reasoning when the allowed list is empty.
 */
export function agentProviderOptions(
  profile: AgentModelProfile,
): { openai: Record<string, string | boolean> } | undefined {
  const openai: Record<string, string | boolean> = {};
  if (
    profile.reasoningEffortParam &&
    profile.reasoningEffortToSend &&
    profile.reasoningEfforts.includes(profile.reasoningEffortToSend)
  ) {
    openai[profile.reasoningEffortParam] = profile.reasoningEffortToSend;
  }
  if (!profile.parallelToolCalls) openai.parallelToolCalls = false;
  if (Object.keys(openai).length === 0) return undefined;
  return { openai };
}
