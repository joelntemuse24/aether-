import { tool, type ToolSet } from "ai";
import {
  TOOL_NAMES,
  executePythonInput,
  webSearchInput,
  createArtifactInput,
  memorySearchInput,
  memoryWriteInput,
  driveSearchInput,
  driveReadInput,
  githubGetRepoInput,
  githubListContentsInput,
  githubReadFileInput,
  fetchUrlInput,
  toolSearchInput,
  requestConfirmationInput,
  browserNavigateInput,
  browserActInput,
  type CreateArtifactOutput,
  type WebSearchOutput,
} from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
import { searchMemories, writeMemory } from "@/lib/memory/store";
import { saveArtifact } from "@/lib/artifacts/store";
import { isCloudDbConfigured } from "@/lib/db";
import {
  driveReadTextForUser,
  driveSearchForUser,
  fetchUrlText,
} from "@/lib/connectors/web-and-drive";
import {
  githubGetRepoForUser,
  githubListContentsForUser,
  githubReadFileForUser,
} from "@/lib/connectors/github";
import { browserAct, browserNavigate } from "@/lib/connectors/browser";
import { createConfirmationRequest } from "@/lib/harness/confirmation";
import {
  runVerifyChecklist,
  verifyChecklistInput,
} from "@/lib/harness/verify";
import type { AgentLoopController } from "@/lib/harness/loop-efficiency";

export type ToolRegistryContext = {
  userId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  /** Optional per-turn loop controller (quotas, deferred discovery). */
  loop?: AgentLoopController;
};

/** Capability-gated tool names for this request (before building the ToolSet). */
export function resolveAvailableToolNames(ctx: {
  userId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
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
  const hasMemory = !!(ctx.userId && isCloudDbConfigured());
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
  const tools: ToolSet = {
    [TOOL_NAMES.executePython]: tool({
      description:
        "Execute Python code in a sandboxed in-browser Pyodide runtime and return stdout and the final expression value. Use for math, data processing, or verifying code.",
      inputSchema: executePythonInput,
    }),
    [TOOL_NAMES.webSearch]: tool({
      description:
        "Search the web for current or factual information and return a list of result snippets. Prefer few focused queries; near-duplicates are blocked. Do not use for inspecting GitHub repositories — use github_* tools instead.",
      inputSchema: webSearchInput,
      execute: async ({ query }): Promise<WebSearchOutput> => {
        const blocked = ctx.loop?.gateWebSearch(query);
        if (blocked) return blocked;
        return runWebSearch(query);
      },
    }),
    [TOOL_NAMES.createArtifact]: tool({
      description:
        "Create a rich artifact (code, document, data, image, or svg) shown in the side panel. Prefer for substantial reusable content. Persists to the user's account when signed in with cloud storage.",
      inputSchema: createArtifactInput,
      execute: async ({
        kind,
        title,
        language,
        content,
      }): Promise<
        CreateArtifactOutput & {
          id?: string;
          persisted?: boolean;
          /** Echo content so the client can open even if args were truncated. */
          content?: string;
        }
      > => {
        if (ctx.userId && isCloudDbConfigured()) {
          try {
            const saved = await saveArtifact(ctx.userId, {
              kind,
              title,
              language,
              content,
              projectId: ctx.projectId ?? undefined,
              conversationId: ctx.conversationId ?? undefined,
            });
            return {
              ok: true,
              kind,
              title,
              id: saved.id,
              persisted: true,
              content,
            };
          } catch (err) {
            console.warn("[create_artifact] persist failed", err);
          }
        }
        return {
          ok: true,
          kind,
          title,
          persisted: false,
          content,
        };
      },
    }),
    [TOOL_NAMES.fetchUrl]: tool({
      description:
        "Fetch a public http(s) URL and return extracted text (HTML stripped). Soft-fails paywalls; PDF text is best-effort. Do not use for github.com repositories — use github_* tools.",
      inputSchema: fetchUrlInput,
      execute: async ({ url }) => fetchUrlText(url),
    }),
    [TOOL_NAMES.verifyChecklist]: tool({
      description:
        "Run a structured verify pass before handing back substantial work (deep research, essays, multi-step jobs). Call after drafting; fix failed checks or state limits clearly.",
      inputSchema: verifyChecklistInput,
      execute: async (input) => runVerifyChecklist(input),
    }),
    [TOOL_NAMES.requestConfirmation]: tool({
      description:
        "Request user approval before any side effect (submit form, send message, upload, irreversible action). Returns needs_confirmation — do not claim the action completed until the user approves.",
      inputSchema: requestConfirmationInput,
      execute: async (input) =>
        createConfirmationRequest(
          {
            action: input.action,
            title: input.title,
            preview: input.preview,
            target: input.target,
          },
          ctx.userId,
        ),
    }),
    [TOOL_NAMES.browserNavigate]: tool({
      description:
        "Open a public URL and extract readable text (fetch mode, or Browserless when configured). Prefer for portal-like pages after the user shares a link. Not for github.com repos.",
      inputSchema: browserNavigateInput,
      execute: async ({ url }) => browserNavigate(url, ctx.userId),
    }),
    [TOOL_NAMES.browserAct]: tool({
      description:
        "Browser action: extract, fill_preview (no apply), click, or submit. submit and submit-like clicks always return needs_confirmation — never auto-submit.",
      inputSchema: browserActInput,
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

  if (ctx.userId && isCloudDbConfigured()) {
    tools[TOOL_NAMES.memorySearch] = tool({
      description:
        "Search the user's curated long-term memory (preferences, people, projects, constraints). Use before assuming you know lasting facts about them. Discover via tool_search first if not already unlocked.",
      inputSchema: memorySearchInput,
      execute: async ({ query }) => {
        const results = await searchMemories(ctx.userId!, query, 8);
        return { ok: true, results };
      },
    });
    tools[TOOL_NAMES.memoryWrite] = tool({
      description:
        "Write or update a lasting memory about the user (preference, person, project, constraint, writing_voice, belief_or_practice, open_question, note). Only store durable facts they would want remembered across chats. Discover via tool_search first if not already unlocked.",
      inputSchema: memoryWriteInput,
      execute: async (input) => {
        const memory = await writeMemory(ctx.userId!, input);
        return { ok: true, memory };
      },
    });
  }

  if (ctx.userId && ctx.hasDrive) {
    tools[TOOL_NAMES.driveSearch] = tool({
      description:
        "Search the user's Google Drive by file name. Returns file ids for drive_read. Discover via tool_search first if not already unlocked.",
      inputSchema: driveSearchInput,
      execute: async ({ query }) => driveSearchForUser(ctx.userId!, query),
    });
    tools[TOOL_NAMES.driveRead] = tool({
      description:
        "Read a Google Drive file as text (Docs/Sheets export or text-like files). Pass a file id from drive_search. Discover via tool_search first if not already unlocked.",
      inputSchema: driveReadInput,
      execute: async ({ fileId }) => driveReadTextForUser(ctx.userId!, fileId),
    });
  }

  if (ctx.userId && ctx.hasGitHub) {
    tools[TOOL_NAMES.githubGetRepo] = tool({
      description:
        "Get metadata for a GitHub repository the signed-in user can access. Pass owner/repo or a github.com URL. Prefer this over fetch_url/web_search for repos.",
      inputSchema: githubGetRepoInput,
      execute: async ({ repo }) => githubGetRepoForUser(ctx.userId!, repo),
    });
    tools[TOOL_NAMES.githubListContents] = tool({
      description:
        "List files and folders at a path in a GitHub repository. Pass owner/repo (or URL), optional path and ref.",
      inputSchema: githubListContentsInput,
      execute: async ({ repo, path, ref }) =>
        githubListContentsForUser(ctx.userId!, repo, path, ref),
    });
    tools[TOOL_NAMES.githubReadFile] = tool({
      description:
        "Read one text file from a GitHub repository by path (README, source, config). Pass owner/repo (or URL), a single path, optional ref. For multiple files, call this tool multiple times in parallel — never put two JSON objects in one call.",
      inputSchema: githubReadFileInput,
      execute: async ({ repo, path, ref }) =>
        githubReadFileForUser(ctx.userId!, repo, path, ref),
    });
  }

  // tool_search only when deferred tools exist for this session.
  const hasDeferred =
    !!tools[TOOL_NAMES.memorySearch] ||
    !!tools[TOOL_NAMES.memoryWrite] ||
    !!tools[TOOL_NAMES.driveSearch] ||
    !!tools[TOOL_NAMES.driveRead] ||
    !!tools[TOOL_NAMES.githubGetRepo] ||
    !!tools[TOOL_NAMES.githubListContents] ||
    !!tools[TOOL_NAMES.githubReadFile];

  if (hasDeferred && ctx.loop) {
    tools[TOOL_NAMES.toolSearch] = tool({
      description:
        "Discover and unlock optional tools by keyword (memory, Drive, GitHub). Call once with clear capability words — e.g. 'memory preferences', 'google drive files', 'github repository' — then use the unlocked tools in later steps of this turn. Sibling tools unlock together (read+write, full GitHub suite).",
      inputSchema: toolSearchInput,
      execute: async ({ query }) => ctx.loop!.runToolSearch(query),
    });
  }

  return tools;
}
