/**
 * One tool definition, rendered into a prompt and into provider schemas.
 * Executors are injected by the loop. This file does not call tools.
 */

import { budgetForDepth, harnessSystemAddendum } from "@/lib/harness/budgets";
import {
  pageFetchBudgetForDepth,
  webSearchBudgetForDepth,
} from "@/lib/harness/loop-efficiency";
import type { HarnessDepth, HarnessIntent } from "@/lib/harness/types";
import {
  isAlwaysConfirmAetherCall,
  isUserDeliverableAetherTool,
  type ToolApprovalMode,
} from "@/lib/hermes/tool-approval";
import { trueforgeClockLine } from "@/lib/trueforge/instructions";
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import type { ZodType } from "zod";
import { agentModelProfile, type AgentModelProfile } from "./profiles";
import { asToolResult, capToolResult, toolError, type ToolResult } from "./results";

export type ToolRisk = "read" | "write" | "destructive";
export type ToolHost = "vm" | "vercel";
export type AgentToolGroup = "web" | "account" | "sandbox";

export type AgentToolDefinition<INPUT = unknown> = {
  name: string;
  description: string;
  inputSchema: ZodType<INPUT>;
  timeoutMs: number;
  risk: ToolRisk;
  runsOn: ToolHost;
  requiresAuth: boolean;
};

export type ProviderToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
};

const SCHEMA_KEYS_TO_DROP = new Set([
  "$schema",
  "format",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "contentMediaType",
  "contentEncoding",
  "additionalProperties",
]);

const UNAVAILABLE_GROUP_LINE: Record<AgentToolGroup, string> = {
  web: "Web search and page tools are unavailable this turn.",
  account: "Account tools are unavailable this turn.",
  sandbox: "The sandbox is unavailable this turn.",
};

export function agentToolGroup(name: string): AgentToolGroup | null {
  if (name === "web_search" || name === "fetch_url" || name === "browse_page" || name === "current_time") {
    return "web";
  }
  if (name === "sandbox_exec" || name === "sandbox_files") return "sandbox";
  if (
    name === "create_artifact" ||
    name === "project_knowledge_search" ||
    name.startsWith("memory_") ||
    name.startsWith("drive_") ||
    name.startsWith("github_")
  ) {
    return "account";
  }
  return null;
}

export function selectAgentTools<T extends { name: string }>(
  definitions: readonly T[],
  profile: AgentModelProfile,
): T[] {
  const max = Math.max(0, profile.recommendedMaxTools);
  return definitions.slice(0, max);
}

export function simplifyJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SCHEMA_KEYS_TO_DROP.has(key)) continue;
      out[key] = walk(child);
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

export function schemaForModel(
  definition: AgentToolDefinition,
  profile: AgentModelProfile,
): { parameters: Record<string, unknown>; strict: boolean } {
  const raw = definition.inputSchema.toJSONSchema() as Record<string, unknown>;
  return {
    parameters: profile.simplifySchemas ? simplifyJsonSchema(raw) : raw,
    strict: profile.strictSchemas,
  };
}

export function providerToolDefinitions(
  definitions: readonly AgentToolDefinition[],
  profile: AgentModelProfile,
): ProviderToolDefinition[] {
  return selectAgentTools(definitions, profile).map((definition) => {
    const schema = schemaForModel(definition, profile);
    return {
      name: definition.name,
      description: definition.description,
      parameters: schema.parameters,
      strict: schema.strict,
    };
  });
}

/**
 * Ask confirms writes. Auto runs writes. Destructive calls and the existing
 * always-confirm list always wait. Reads never wait.
 *
 * `approvalDecisionForAetherTool` fail-closes unknown names, which would put a
 * card on web_search. Native tools declare `risk` instead.
 */
export function agentToolNeedsConfirmation(input: {
  name: string;
  risk: ToolRisk;
  args?: Record<string, unknown>;
  mode: ToolApprovalMode;
  skipGate?: boolean;
}): boolean {
  if (input.skipGate) return false;
  if (isAlwaysConfirmAetherCall(input.name, input.args)) return true;
  if (input.risk === "destructive") return true;
  if (input.risk === "read") return false;
  if (isUserDeliverableAetherTool(input.name)) return false;
  if (input.mode === "auto") return false;
  return true;
}

export function agentSystemPrompt(input: {
  base?: string;
  definitions: readonly AgentToolDefinition[];
  unavailableGroups?: readonly AgentToolGroup[];
  now?: Date;
  timeZone?: string | null;
  depth?: HarnessDepth;
  intent?: HarnessIntent;
}): string {
  const depth = input.depth ?? "standard";
  const intent = input.intent ?? "chat";
  const attached = input.definitions;
  const lines: string[] = [];
  if (input.base?.trim()) lines.push(input.base.trim());
  lines.push(trueforgeClockLine(input.now ?? new Date(), input.timeZone));
  lines.push(
    harnessSystemAddendum({ depth, intent }),
    `Step budget: ${budgetForDepth(depth).maxSteps}. Search budget: ${webSearchBudgetForDepth(depth)}. Page budget: ${pageFetchBudgetForDepth(depth)}.`,
  );

  if (attached.length === 0) {
    lines.push(
      "No tools are attached this turn. Answer from the conversation. Do not invent tool results.",
    );
  } else {
    lines.push("Tools attached this turn:");
    for (const definition of attached) {
      lines.push(`- ${definition.name}: ${definition.description}`);
    }
    lines.push(
      "Search before asserting current facts. For a broad question, search more than once. Cite sources as [1], [2]. Verify tool results before you rely on them. If a tool fails, say so plainly.",
      "Do not invent tools you were not given.",
    );
  }

  for (const group of input.unavailableGroups ?? []) {
    const present = attached.some((definition) => agentToolGroup(definition.name) === group);
    if (present) continue;
    lines.push(UNAVAILABLE_GROUP_LINE[group]);
  }

  return lines.join("\n");
}

export type AgentToolExecute = (call: {
  name: string;
  input: unknown;
  toolCallId: string;
  abortSignal: AbortSignal;
}) => Promise<unknown>;

export type PendingApproval = {
  confirmationId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  title: string;
  preview: string;
};

export function confirmationResult(pending: PendingApproval): ToolResult & {
  needs_confirmation: true;
  confirmation_id: string;
  title: string;
  preview: string;
} {
  return {
    ok: false,
    error: "This step needs your approval.",
    retryable: false,
    needs_confirmation: true,
    confirmation_id: pending.confirmationId,
    title: pending.title,
    preview: pending.preview,
  };
}

/**
 * AI SDK tools for the definitions this profile will actually see.
 * `execute` enforces timeout, approval, and the result cap.
 */
export function toAiSdkTools(input: {
  definitions: readonly AgentToolDefinition[];
  profile?: AgentModelProfile;
  modelId?: string;
  executeTool: AgentToolExecute;
  approvalMode?: ToolApprovalMode;
  concurrency?: number;
  approvedToolCallIds?: readonly string[];
  parentSignal?: AbortSignal;
  onApproval?: (pending: PendingApproval) => void;
}): ToolSet {
  const profile = input.profile ?? agentModelProfile(input.modelId ?? "unknown");
  const selected = selectAgentTools(input.definitions, profile);
  const mode = input.approvalMode ?? "ask";
  const concurrency = profile.parallelToolCalls ? Math.max(1, input.concurrency ?? 4) : 1;
  const limit = createLimiter(concurrency);
  const approved = new Set(input.approvedToolCallIds ?? []);
  const tools: ToolSet = {};

  for (const definition of selected) {
    const schema = schemaForModel(definition, profile);
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: profile.simplifySchemas
        ? jsonSchema(schema.parameters as JSONSchema7)
        : definition.inputSchema,
      strict: schema.strict,
      execute: async (args, options) => {
        return limit(async () => {
          const parent = input.parentSignal;
          if (parent?.aborted) {
            throw parent.reason ?? new DOMException("The operation was aborted.", "AbortError");
          }
          const record =
            args && typeof args === "object" && !Array.isArray(args)
              ? (args as Record<string, unknown>)
              : {};
          const needsConfirmation = agentToolNeedsConfirmation({
            name: definition.name,
            risk: definition.risk,
            args: record,
            mode,
            skipGate: approved.has(options.toolCallId),
          });
          if (needsConfirmation) {
            const pending: PendingApproval = {
              confirmationId: `confirm_${options.toolCallId}`,
              toolCallId: options.toolCallId,
              toolName: definition.name,
              input: args,
              title: `Allow ${definition.name}?`,
              preview: JSON.stringify(args).slice(0, 280),
            };
            input.onApproval?.(pending);
            return confirmationResult(pending);
          }

          const child = new AbortController();
          const signals = [child.signal, options.abortSignal, parent].filter(
            (signal): signal is AbortSignal => !!signal,
          );
          const signal = AbortSignal.any(signals);
          return runTool(definition.timeoutMs, parent, child, () =>
            input.executeTool({
              name: definition.name,
              input: args,
              toolCallId: options.toolCallId,
              abortSignal: signal,
            }),
          );
        });
      },
    });
  }

  return tools;
}

async function runTool(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  child: AbortController,
  work: () => Promise<unknown>,
): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.abort();
      resolve(toolError("Tool timed out.", true));
    }, timeoutMs);
    const onParent = () => {
      clearTimeout(timer);
      child.abort();
      reject(parent?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    };
    if (parent?.aborted) {
      onParent();
      return;
    }
    parent?.addEventListener("abort", onParent, { once: true });
    Promise.resolve()
      .then(work)
      .then(
        (value) => {
          clearTimeout(timer);
          parent?.removeEventListener("abort", onParent);
          resolve(capToolResult(asToolResult(value)));
        },
        (error: unknown) => {
          clearTimeout(timer);
          parent?.removeEventListener("abort", onParent);
          if (parent?.aborted || isAbortError(error)) {
            reject(error);
            return;
          }
          if (child.signal.aborted) {
            resolve(toolError("Tool timed out.", true));
            return;
          }
          resolve(toolError("Tool failed.", true));
        },
      );
  });
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError";
}

function createLimiter(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}
