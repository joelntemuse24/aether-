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
import { browsePage } from "@/lib/connectors/browse-page";
import { searchImages } from "@/lib/connectors/image-search";
import {
  browserAct,
  browserNavigate,
  browserSnapshot,
} from "@/lib/connectors/browser";
import { toVisionToolModelOutput } from "@/lib/harness/vision-tool-output";
import { runVerifyChecklist } from "@/lib/harness/verify";
import { buildHeadStartToolSchemas } from "@/lib/harness/tool-schemas";
import { resolveCurrentTime } from "@/lib/current-time";
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
  hasGmail?: boolean;
  hasCalendar?: boolean;
  hasContacts?: boolean;
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
  hasGmail?: boolean;
  hasCalendar?: boolean;
  hasContacts?: boolean;
}): string[] {
  const names: string[] = [
    TOOL_NAMES.executePython,
    TOOL_NAMES.currentTime,
    TOOL_NAMES.webSearch,
    TOOL_NAMES.fetchUrl,
    TOOL_NAMES.browsePage,
    TOOL_NAMES.browserSnapshot,
    TOOL_NAMES.searchImages,
    TOOL_NAMES.createArtifact,
    TOOL_NAMES.verifyChecklist,
    TOOL_NAMES.requestConfirmation,
    TOOL_NAMES.browserNavigate,
    TOOL_NAMES.browserAct,
    TOOL_NAMES.workspaceExec,
    TOOL_NAMES.workspaceFfmpeg,
    TOOL_NAMES.scheduleCreate,
    TOOL_NAMES.scheduleList,
    TOOL_NAMES.scheduleCancel,
    TOOL_NAMES.designList,
    TOOL_NAMES.designRead,
    TOOL_NAMES.deploymentsList,
    TOOL_NAMES.deploymentsRead,
    TOOL_NAMES.socialSearch,
    TOOL_NAMES.workspaceReadFile,
    TOOL_NAMES.workspaceWriteFile,
    TOOL_NAMES.workspaceListFiles,
    TOOL_NAMES.workspacePublishFile,
    TOOL_NAMES.createPresentation,
    TOOL_NAMES.createSpreadsheet,
    TOOL_NAMES.createDocument,
    TOOL_NAMES.createPdf,
    TOOL_NAMES.generateImage,
    TOOL_NAMES.githubListIssues,
    TOOL_NAMES.githubGetIssue,
    TOOL_NAMES.githubListPullRequests,
    TOOL_NAMES.githubGetPullRequest,
    TOOL_NAMES.githubListCommits,
    TOOL_NAMES.githubCreateBranch,
    TOOL_NAMES.githubCreateOrUpdateFile,
    TOOL_NAMES.githubCreateIssue,
    TOOL_NAMES.githubAddIssueComment,
    TOOL_NAMES.githubCreatePullRequest,
    TOOL_NAMES.githubMergePullRequest,
  ];
  const hasMemory =
    ctx.hasMemory ?? !!(ctx.userId && isCloudDbConfigured());
  const hasDrive = !!(ctx.userId && ctx.hasDrive);
  const hasGitHub = !!(ctx.userId && ctx.hasGitHub);
  const hasGmail = !!(ctx.userId && ctx.hasGmail);
  const hasCalendar = !!(ctx.userId && ctx.hasCalendar);
  const hasContacts = !!(ctx.userId && ctx.hasContacts);
  if (hasMemory) {
    names.push(
      TOOL_NAMES.memorySearch,
      TOOL_NAMES.memoryWrite,
      TOOL_NAMES.projectKnowledgeSearch,
    );
  }
  if (hasDrive) {
    names.push(
      TOOL_NAMES.driveSearch,
      TOOL_NAMES.driveRead,
      TOOL_NAMES.driveUpload,
      TOOL_NAMES.driveWrite,
    );
  }
  if (hasGmail) {
    names.push(
      TOOL_NAMES.gmailSearch,
      TOOL_NAMES.gmailRead,
      TOOL_NAMES.gmailSend,
      TOOL_NAMES.gmailCreateDraft,
    );
  }
  if (hasCalendar) {
    names.push(
      TOOL_NAMES.calendarListEvents,
      TOOL_NAMES.calendarCreateEvent,
      TOOL_NAMES.calendarDeleteEvent,
    );
  }
  if (hasContacts) {
    names.push(TOOL_NAMES.contactsSearch, TOOL_NAMES.contactsCreate);
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
    hasGmail: !!ctx.hasGmail,
    hasCalendar: !!ctx.hasCalendar,
    hasContacts: !!ctx.hasContacts,
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
    hasGmail: !!(ctx.userId && ctx.hasGmail),
    hasCalendar: !!(ctx.userId && ctx.hasCalendar),
    hasContacts: !!(ctx.userId && ctx.hasContacts),
  });

  const tools: ToolSet = {
    ...schemas,
    [TOOL_NAMES.currentTime]: tool({
      ...schemas[TOOL_NAMES.currentTime],
      execute: async ({ timeZone }) => resolveCurrentTime({ timeZone }),
    }),
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
    [TOOL_NAMES.browsePage]: tool({
      ...schemas[TOOL_NAMES.browsePage],
      execute: async ({ url, instructions }) => browsePage({ url, instructions }),
    }),
    [TOOL_NAMES.browserSnapshot]: tool({
      ...schemas[TOOL_NAMES.browserSnapshot],
      execute: async ({ url, screenshot }) =>
        browserSnapshot({
          url,
          screenshot,
          userId: ctx.userId,
          persistImage: async ({ title, dataUrl }) => {
            const saved = await runAether(TOOL_NAMES.createArtifact, {
              kind: "image",
              title,
              content: dataUrl,
            });
            const rec = saved as {
              id?: string;
              persisted?: boolean;
              content?: string;
            };
            return {
              id: rec.id,
              persisted: !!rec.persisted,
              content: rec.content,
            };
          },
        }),
      toModelOutput: ({ output }) => {
        const rec = output as {
          title?: string;
          text?: string;
          content?: string;
          mime?: string;
        };
        return toVisionToolModelOutput(rec);
      },
    }),
    [TOOL_NAMES.searchImages]: tool({
      ...schemas[TOOL_NAMES.searchImages],
      execute: async ({ query }) => searchImages(query),
    }),
    [TOOL_NAMES.verifyChecklist]: tool({
      ...schemas[TOOL_NAMES.verifyChecklist],
      execute: async (input) => runVerifyChecklist(input),
    }),
    [TOOL_NAMES.workspaceExec]: tool({
      ...schemas[TOOL_NAMES.workspaceExec],
      execute: async (input) => runAether(TOOL_NAMES.workspaceExec, input),
    }),
    [TOOL_NAMES.workspaceFfmpeg]: tool({
      ...schemas[TOOL_NAMES.workspaceFfmpeg],
      execute: async (input) => runAether(TOOL_NAMES.workspaceFfmpeg, input),
    }),
    [TOOL_NAMES.scheduleCreate]: tool({
      ...schemas[TOOL_NAMES.scheduleCreate],
      execute: async (input) => runAether(TOOL_NAMES.scheduleCreate, input),
    }),
    [TOOL_NAMES.scheduleList]: tool({
      ...schemas[TOOL_NAMES.scheduleList],
      execute: async (input) => runAether(TOOL_NAMES.scheduleList, input),
    }),
    [TOOL_NAMES.scheduleCancel]: tool({
      ...schemas[TOOL_NAMES.scheduleCancel],
      execute: async (input) => runAether(TOOL_NAMES.scheduleCancel, input),
    }),
    [TOOL_NAMES.designList]: tool({
      ...schemas[TOOL_NAMES.designList],
      execute: async (input) => runAether(TOOL_NAMES.designList, input),
    }),
    [TOOL_NAMES.designRead]: tool({
      ...schemas[TOOL_NAMES.designRead],
      execute: async (input) => runAether(TOOL_NAMES.designRead, input),
    }),
    [TOOL_NAMES.deploymentsList]: tool({
      ...schemas[TOOL_NAMES.deploymentsList],
      execute: async (input) => runAether(TOOL_NAMES.deploymentsList, input),
    }),
    [TOOL_NAMES.deploymentsRead]: tool({
      ...schemas[TOOL_NAMES.deploymentsRead],
      execute: async (input) => runAether(TOOL_NAMES.deploymentsRead, input),
    }),
    [TOOL_NAMES.socialSearch]: tool({
      ...schemas[TOOL_NAMES.socialSearch],
      execute: async (input) => runAether(TOOL_NAMES.socialSearch, input),
    }),
    [TOOL_NAMES.workspaceReadFile]: tool({
      ...schemas[TOOL_NAMES.workspaceReadFile],
      execute: async (input) => runAether(TOOL_NAMES.workspaceReadFile, input),
    }),
    [TOOL_NAMES.workspaceWriteFile]: tool({
      ...schemas[TOOL_NAMES.workspaceWriteFile],
      execute: async (input) => runAether(TOOL_NAMES.workspaceWriteFile, input),
    }),
    [TOOL_NAMES.workspaceListFiles]: tool({
      ...schemas[TOOL_NAMES.workspaceListFiles],
      execute: async (input) => runAether(TOOL_NAMES.workspaceListFiles, input),
    }),
    [TOOL_NAMES.workspacePublishFile]: tool({
      ...schemas[TOOL_NAMES.workspacePublishFile],
      execute: async (input) => runAether(TOOL_NAMES.workspacePublishFile, input),
    }),
    [TOOL_NAMES.createPresentation]: tool({
      ...schemas[TOOL_NAMES.createPresentation],
      execute: async (input) => runAether(TOOL_NAMES.createPresentation, input),
    }),
    [TOOL_NAMES.createSpreadsheet]: tool({
      ...schemas[TOOL_NAMES.createSpreadsheet],
      execute: async (input) => runAether(TOOL_NAMES.createSpreadsheet, input),
    }),
    [TOOL_NAMES.createDocument]: tool({
      ...schemas[TOOL_NAMES.createDocument],
      execute: async (input) => runAether(TOOL_NAMES.createDocument, input),
    }),
    [TOOL_NAMES.createPdf]: tool({
      ...schemas[TOOL_NAMES.createPdf],
      execute: async (input) => runAether(TOOL_NAMES.createPdf, input),
    }),
    [TOOL_NAMES.generateImage]: tool({
      ...schemas[TOOL_NAMES.generateImage],
      execute: async (input) => runAether(TOOL_NAMES.generateImage, input),
      toModelOutput: ({ output }) => {
        const rec = output as {
          title?: string;
          content?: string;
          mime?: string;
          error?: string;
        };
        return toVisionToolModelOutput({
          title: rec.title,
          text: rec.error,
          content: rec.content,
          mime: rec.mime,
        });
      },
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
  if (schemas[TOOL_NAMES.projectKnowledgeSearch]) {
    tools[TOOL_NAMES.projectKnowledgeSearch] = tool({
      ...schemas[TOOL_NAMES.projectKnowledgeSearch],
      execute: async (input) =>
        runAether(TOOL_NAMES.projectKnowledgeSearch, input),
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
  if (schemas[TOOL_NAMES.driveUpload]) {
    tools[TOOL_NAMES.driveUpload] = tool({
      ...schemas[TOOL_NAMES.driveUpload],
      execute: async (input) => runAether(TOOL_NAMES.driveUpload, input),
    });
  }
  if (schemas[TOOL_NAMES.driveWrite]) {
    tools[TOOL_NAMES.driveWrite] = tool({
      ...schemas[TOOL_NAMES.driveWrite],
      execute: async (input) => runAether(TOOL_NAMES.driveWrite, input),
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

  if (schemas[TOOL_NAMES.githubListIssues]) {
    for (const name of [
      TOOL_NAMES.githubListIssues,
      TOOL_NAMES.githubGetIssue,
      TOOL_NAMES.githubListPullRequests,
      TOOL_NAMES.githubGetPullRequest,
      TOOL_NAMES.githubListCommits,
      TOOL_NAMES.githubCreateBranch,
      TOOL_NAMES.githubCreateOrUpdateFile,
      TOOL_NAMES.githubCreateIssue,
      TOOL_NAMES.githubAddIssueComment,
      TOOL_NAMES.githubCreatePullRequest,
      TOOL_NAMES.githubMergePullRequest,
    ]) {
      tools[name] = tool({
        ...schemas[name],
        execute: async (input) => runAether(name, input),
      });
    }
  }

  if (schemas[TOOL_NAMES.gmailSearch]) {
    for (const name of [
      TOOL_NAMES.gmailSearch,
      TOOL_NAMES.gmailRead,
      TOOL_NAMES.gmailSend,
      TOOL_NAMES.gmailCreateDraft,
      TOOL_NAMES.calendarListEvents,
      TOOL_NAMES.calendarCreateEvent,
      TOOL_NAMES.calendarDeleteEvent,
      TOOL_NAMES.contactsSearch,
      TOOL_NAMES.contactsCreate,
    ]) {
      tools[name] = tool({
        ...schemas[name],
        execute: async (input) => runAether(name, input),
      });
    }
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
