/**
 * Schema-only tools for the first-turn warm path.
 * This module must stay limited to `ai` + `zod` (+ local zod schemas).
 * Heavy execute deps belong on the durable agent, not this import graph.
 */

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
} from "@/lib/tools";
import { verifyChecklistInput } from "@/lib/harness/verify";

export type HeadStartToolCapabilities = {
  toolsEnabled?: boolean;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
};

export function buildHeadStartToolSchemas(
  ctx: HeadStartToolCapabilities = {},
): ToolSet {
  if (ctx.toolsEnabled === false) return {};

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
    }),
    [TOOL_NAMES.createArtifact]: tool({
      description:
        "Create a rich artifact (code, document, data, image, or svg) shown in the side panel. Prefer for substantial reusable content. Persists to the user's account when signed in with cloud storage.",
      inputSchema: createArtifactInput,
    }),
    [TOOL_NAMES.fetchUrl]: tool({
      description:
        "Fetch a public http(s) URL and return extracted text (HTML stripped). Soft-fails paywalls; PDF text is best-effort. Do not use for github.com repositories — use github_* tools.",
      inputSchema: fetchUrlInput,
    }),
    [TOOL_NAMES.verifyChecklist]: tool({
      description:
        "Run a structured verify pass before handing back substantial work (deep research, essays, multi-step jobs). Call after drafting; fix failed checks or state limits clearly.",
      inputSchema: verifyChecklistInput,
    }),
    [TOOL_NAMES.requestConfirmation]: tool({
      description:
        "Request user approval before any side effect (submit form, send message, upload, irreversible action). Returns needs_confirmation — do not claim the action completed until the user approves.",
      inputSchema: requestConfirmationInput,
    }),
    [TOOL_NAMES.browserNavigate]: tool({
      description:
        "Open a public URL and extract readable text (fetch mode, or Browserless when configured). Prefer for portal-like pages after the user shares a link. Not for github.com repos.",
      inputSchema: browserNavigateInput,
    }),
    [TOOL_NAMES.browserAct]: tool({
      description:
        "Browser action: extract, fill_preview (no apply), click, or submit. submit and submit-like clicks always return needs_confirmation — never auto-submit.",
      inputSchema: browserActInput,
    }),
  };

  if (ctx.hasMemory) {
    tools[TOOL_NAMES.memorySearch] = tool({
      description:
        "Search the user's curated long-term memory (preferences, people, projects, constraints). Use before assuming you know lasting facts about them. Discover via tool_search first if not already unlocked.",
      inputSchema: memorySearchInput,
    });
    tools[TOOL_NAMES.memoryWrite] = tool({
      description:
        "Write or update a lasting memory about the user (preference, person, project, constraint, writing_voice, belief_or_practice, open_question, note). Only store durable facts they would want remembered across chats. Discover via tool_search first if not already unlocked.",
      inputSchema: memoryWriteInput,
    });
  }

  if (ctx.hasDrive) {
    tools[TOOL_NAMES.driveSearch] = tool({
      description:
        "Search the user's Google Drive by file name. Returns file ids for drive_read. Discover via tool_search first if not already unlocked.",
      inputSchema: driveSearchInput,
    });
    tools[TOOL_NAMES.driveRead] = tool({
      description:
        "Read a Google Drive file as text (Docs/Sheets export or text-like files). Pass a file id from drive_search. Discover via tool_search first if not already unlocked.",
      inputSchema: driveReadInput,
    });
  }

  if (ctx.hasGitHub) {
    tools[TOOL_NAMES.githubGetRepo] = tool({
      description:
        "Get metadata for a GitHub repository the signed-in user can access. Pass owner/repo or a github.com URL. Prefer this over fetch_url/web_search for repos.",
      inputSchema: githubGetRepoInput,
    });
    tools[TOOL_NAMES.githubListContents] = tool({
      description:
        "List files and folders at a path in a GitHub repository. Pass owner/repo (or URL), optional path and ref.",
      inputSchema: githubListContentsInput,
    });
    tools[TOOL_NAMES.githubReadFile] = tool({
      description:
        "Read one text file from a GitHub repository by path (README, source, config). Pass owner/repo (or URL), a single path, optional ref. For multiple files, call this tool multiple times in parallel — never put two JSON objects in one call.",
      inputSchema: githubReadFileInput,
    });
  }

  const hasDeferred =
    !!tools[TOOL_NAMES.memorySearch] ||
    !!tools[TOOL_NAMES.driveSearch] ||
    !!tools[TOOL_NAMES.githubGetRepo];

  if (hasDeferred) {
    tools[TOOL_NAMES.toolSearch] = tool({
      description:
        "Discover and unlock optional tools by keyword (memory, Drive, GitHub). Call once with clear capability words — e.g. 'memory preferences', 'google drive files', 'github repository' — then use the unlocked tools in later steps of this turn. Sibling tools unlock together (read+write, full GitHub suite).",
      inputSchema: toolSearchInput,
    });
  }

  return tools;
}
