import { tool, type ToolSet } from "ai";
import {
  TOOL_NAMES,
  type CreateArtifactOutput,
  type WebSearchOutput,
} from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
import { isCloudDbConfigured } from "@/lib/db";
import {
  fetchUrlText,
} from "@/lib/connectors/web-and-drive";
import { browserAct, browserNavigate } from "@/lib/connectors/browser";
import { runVerifyChecklist } from "@/lib/harness/verify";
import { buildHeadStartToolSchemas } from "@/lib/harness/tool-schemas";
import type { AgentLoopController } from "@/lib/harness/loop-efficiency";
import {
  DEFAULT_TOOL_APPROVAL_MODE,
  type ToolApprovalMode,
} from "@/lib/hermes/tool-approval";

export type ToolRegistryContext = {
  userId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
  approvalMode?: ToolApprovalMode;
  /** Optional per-turn loop controller (quotas, deferred discovery). */
  loop?: AgentLoopController;
  /**
   * When set (durable agent), Aether-owned tools callback into Vercel
   * instead of reading Drive/GitHub cookies in-process.
   */
  executeAetherOwned?: (name: string, args: unknown) => Promise<unknown>;
};

/** Capability-gated tool names for this request (before building the ToolSet). */
export function resolveAvailableToolNames(ctx: {
  userId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
}): string[] {
  const names: string[] = [
    TOOL_NAMES.executePython,
    TOOL_NAMES.webSearch,
    TOOL_NAMES.fetchUrl,
    TOOL_NAMES.createArtifact,
    TOOL_NAMES.verifyChecklist,
    TOOL_NAMES.requestConfirmation,
    TOOL_NAMES.browserNavigate,
    TOOL_NAMES.browserAct,
  ];
  const hasMemory =
    ctx.hasMemory ?? !!(ctx.userId && isCloudDbConfigured());
  const hasDrive = !!(ctx.userId && ctx.hasDrive);
  const hasGitHub = !!(ctx.userId && ctx.hasGitHub);
  if (hasMemory) {
    names.push(TOOL_NAMES.memorySearch, TOOL_NAMES.memoryWrite);
  }
  if (hasDrive) {
    names.push(TOOL_NAMES.driveSearch, TOOL_NAMES.driveRead);
  }
  if (hasGitHub) {
    names.push(
      TOOL_NAMES.githubGetRepo,
      TOOL_NAMES.githubListContents,
      TOOL_NAMES.githubReadFile,
    );
  }
  if (hasMemory || hasDrive || hasGitHub) {
    names.push(TOOL_NAMES.toolSearch);
  }
  return names;
}

/** Build the tool set for this request (capabilities depend on auth/Drive/GitHub/DB). */
export function buildToolRegistry(ctx: ToolRegistryContext): ToolSet {
  const aetherCtx = {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    projectId: ctx.projectId,
    approvalMode: ctx.approvalMode ?? DEFAULT_TOOL_APPROVAL_MODE,
    hasMemory: ctx.hasMemory ?? !!(ctx.userId && isCloudDbConfigured()),
    hasDrive: !!ctx.hasDrive,
    hasGitHub: !!ctx.hasGitHub,
  };
  const runAether = async (name: string, args: unknown) => {
    if (ctx.executeAetherOwned) return ctx.executeAetherOwned(name, args);
    const { executeAetherTool } = await import("@/lib/hermes/aether-tools");
    return executeAetherTool({ name, args, ctx: aetherCtx });
  };

  const schemas = buildHeadStartToolSchemas({
    toolsEnabled: true,
    hasMemory: !!(ctx.userId && aetherCtx.hasMemory),
    hasDrive: !!(ctx.userId && ctx.hasDrive),
    hasGitHub: !!(ctx.userId && ctx.hasGitHub),
  });

  const tools: ToolSet = {
    ...schemas,
    [TOOL_NAMES.webSearch]: tool({
      ...schemas[TOOL_NAMES.webSearch],
      execute: async ({ query }): Promise<WebSearchOutput> => {
        const blocked = ctx.loop?.gateWebSearch(query);
        if (blocked) return blocked;
        return runWebSearch(query);
      },
    }),
    [TOOL_NAMES.createArtifact]: tool({
      ...schemas[TOOL_NAMES.createArtifact],
      execute: async ({
        kind,
        title,
        language,
        content,
      }): Promise<
        CreateArtifactOutput & {
          id?: string;
          persisted?: boolean;
          content?: string;
        }
      > => {
        const result = await runAether(TOOL_NAMES.createArtifact, {
          kind,
          title,
          language,
          content,
        });
        return result as CreateArtifactOutput & {
          id?: string;
          persisted?: boolean;
          content?: string;
        };
      },
    }),
    [TOOL_NAMES.fetchUrl]: tool({
      ...schemas[TOOL_NAMES.fetchUrl],
      execute: async ({ url }) => fetchUrlText(url),
    }),
    [TOOL_NAMES.verifyChecklist]: tool({
      ...schemas[TOOL_NAMES.verifyChecklist],
      execute: async (input) => runVerifyChecklist(input),
    }),
    [TOOL_NAMES.requestConfirmation]: tool({
      ...schemas[TOOL_NAMES.requestConfirmation],
      execute: async (input) =>
        runAether(TOOL_NAMES.requestConfirmation, input),
    }),
    [TOOL_NAMES.browserNavigate]: tool({
      ...schemas[TOOL_NAMES.browserNavigate],
      execute: async ({ url }) => browserNavigate(url, ctx.userId),
    }),
    [TOOL_NAMES.browserAct]: tool({
      ...schemas[TOOL_NAMES.browserAct],
      execute: async (input) =>
        browserAct({
          url: input.url,
          action: input.action,
          selector: input.selector,
          value: input.value,
          description: input.description,
          userId: ctx.userId,
        }),
    }),
  };

  if (schemas[TOOL_NAMES.memorySearch]) {
    tools[TOOL_NAMES.memorySearch] = tool({
      ...schemas[TOOL_NAMES.memorySearch],
      execute: async ({ query }) =>
        runAether(TOOL_NAMES.memorySearch, { query }),
    });
  }
  if (schemas[TOOL_NAMES.memoryWrite]) {
    tools[TOOL_NAMES.memoryWrite] = tool({
      ...schemas[TOOL_NAMES.memoryWrite],
      execute: async (input) => runAether(TOOL_NAMES.memoryWrite, input),
    });
  }
  if (schemas[TOOL_NAMES.driveSearch]) {
    tools[TOOL_NAMES.driveSearch] = tool({
      ...schemas[TOOL_NAMES.driveSearch],
      execute: async ({ query }) =>
        runAether(TOOL_NAMES.driveSearch, { query }),
    });
  }
  if (schemas[TOOL_NAMES.driveRead]) {
    tools[TOOL_NAMES.driveRead] = tool({
      ...schemas[TOOL_NAMES.driveRead],
      execute: async ({ fileId }) =>
        runAether(TOOL_NAMES.driveRead, { fileId }),
    });
  }
  if (schemas[TOOL_NAMES.githubGetRepo]) {
    tools[TOOL_NAMES.githubGetRepo] = tool({
      ...schemas[TOOL_NAMES.githubGetRepo],
      execute: async ({ repo }) =>
        runAether(TOOL_NAMES.githubGetRepo, { repo }),
    });
  }
  if (schemas[TOOL_NAMES.githubListContents]) {
    tools[TOOL_NAMES.githubListContents] = tool({
      ...schemas[TOOL_NAMES.githubListContents],
      execute: async ({ repo, path, ref }) =>
        runAether(TOOL_NAMES.githubListContents, { repo, path, ref }),
    });
  }
  if (schemas[TOOL_NAMES.githubReadFile]) {
    tools[TOOL_NAMES.githubReadFile] = tool({
      ...schemas[TOOL_NAMES.githubReadFile],
      execute: async ({ repo, path, ref }) =>
        runAether(TOOL_NAMES.githubReadFile, { repo, path, ref }),
    });
  }

  if (schemas[TOOL_NAMES.toolSearch] && ctx.loop) {
    tools[TOOL_NAMES.toolSearch] = tool({
      ...schemas[TOOL_NAMES.toolSearch],
      execute: async ({ query }) => ctx.loop!.runToolSearch(query),
    });
  } else if (schemas[TOOL_NAMES.toolSearch] && !ctx.loop) {
    delete tools[TOOL_NAMES.toolSearch];
  }

  return tools;
}
