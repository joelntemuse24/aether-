import { z } from "zod";

/**
 * Shared tool definitions used by both the server (to declare tools for the
 * model) and the client (to render tool calls and, for client-executed tools,
 * to run them). Keeping the input schemas here guarantees the server and client
 * agree on shapes without duplicating types.
 */

export const TOOL_NAMES = {
  executePython: "execute_python",
  webSearch: "web_search",
  createArtifact: "create_artifact",
  memorySearch: "memory_search",
  memoryWrite: "memory_write",
  driveSearch: "drive_search",
  driveRead: "drive_read",
  githubGetRepo: "github_get_repo",
  githubListContents: "github_list_contents",
  githubReadFile: "github_read_file",
  fetchUrl: "fetch_url",
  /** Deferred discovery — unlocks memory/Drive/GitHub tools into later steps. */
  toolSearch: "tool_search",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Tools executed in the browser (no server-side `execute`). */
export const CLIENT_TOOLS: ReadonlySet<string> = new Set([
  TOOL_NAMES.executePython,
]);

export function isClientTool(name: string): boolean {
  return CLIENT_TOOLS.has(name);
}

// ─── Artifact kinds ───

export const ARTIFACT_KINDS = [
  "code",
  "document",
  "data",
  "image",
  "svg",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// ─── Input schemas ───

export const executePythonInput = z.object({
  code: z.string().describe("The Python source code to execute."),
  description: z
    .string()
    .optional()
    .describe("A short description of what the code does."),
});
export type ExecutePythonInput = z.infer<typeof executePythonInput>;

export const executePythonOutput = z.object({
  ok: z.boolean(),
  stdout: z.string().default(""),
  result: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});
export type ExecutePythonOutput = z.infer<typeof executePythonOutput>;

export const webSearchInput = z.object({
  query: z.string().describe("The search query."),
});
export type WebSearchInput = z.infer<typeof webSearchInput>;

export type WebSearchResult = {
  title: string;
  snippet: string;
  url?: string;
};
export type WebSearchOutput = {
  ok: boolean;
  query: string;
  source?: string;
  results: WebSearchResult[];
  error?: string;
  /** Soft quality note (e.g. encyclopedia-only for a current-facts query). */
  warning?: string;
};

export const createArtifactInput = z.object({
  kind: z
    .enum(ARTIFACT_KINDS)
    .describe(
      "The artifact type: 'code' for source code, 'document' for markdown prose, 'data' for JSON/tabular data, 'image' for an image data URL, 'svg' for inline SVG markup.",
    ),
  title: z.string().describe("A short, human-friendly title."),
  language: z
    .string()
    .optional()
    .describe("For code artifacts, the programming language (e.g. 'tsx')."),
  content: z
    .string()
    .describe(
      "The artifact body. Code/markdown/JSON as text, SVG markup for 'svg', or a data URL / https URL for 'image'.",
    ),
});
export type CreateArtifactInput = z.infer<typeof createArtifactInput>;

export type CreateArtifactOutput = {
  ok: boolean;
  kind: ArtifactKind;
  title: string;
  id?: string;
  persisted?: boolean;
};

export const memorySearchInput = z.object({
  query: z
    .string()
    .describe("Search query for the user's curated long-term memory."),
});

export const memoryWriteInput = z.object({
  id: z.string().optional().describe("Existing memory id to update."),
  type: z
    .enum([
      "preference",
      "person",
      "project",
      "belief_or_practice",
      "open_question",
      "writing_voice",
      "constraint",
      "note",
    ])
    .optional(),
  title: z.string().describe("Short memory title."),
  body: z.string().describe("Memory body / details."),
  importance: z.enum(["low", "normal", "high"]).optional(),
  tags: z.array(z.string()).optional(),
});

export const driveSearchInput = z.object({
  query: z.string().describe("Drive file name search query."),
});

export const driveReadInput = z.object({
  fileId: z.string().describe("Google Drive file id."),
});

export const githubGetRepoInput = z.object({
  repo: z
    .string()
    .describe(
      "GitHub repository as owner/repo or a github.com URL (blob/tree links are ok).",
    ),
});

export const githubListContentsInput = z.object({
  repo: z
    .string()
    .describe("GitHub repository as owner/repo or a github.com URL."),
  path: z
    .string()
    .optional()
    .describe("Directory path inside the repo (omit for the root)."),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA (defaults to the repo default branch)."),
});

export const githubReadFileInput = z.object({
  repo: z
    .string()
    .describe("GitHub repository as owner/repo or a github.com URL."),
  path: z.string().describe("File path inside the repo (e.g. README.md)."),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA (defaults to the repo default branch)."),
});

export const fetchUrlInput = z.object({
  url: z.string().url().describe("Public http(s) URL to fetch as text."),
});

export const toolSearchInput = z.object({
  query: z
    .string()
    .describe(
      "Keywords for the capability you need (e.g. 'memory preferences', 'google drive files', 'github repository').",
    ),
});
export type ToolSearchInput = z.infer<typeof toolSearchInput>;

// ─── Display metadata (client rendering) ───

export type ToolDisplay = {
  label: string;
  runningLabel: string;
};

export const TOOL_DISPLAY: Record<string, ToolDisplay> = {
  [TOOL_NAMES.executePython]: {
    label: "Python",
    runningLabel: "Running Python…",
  },
  [TOOL_NAMES.webSearch]: {
    label: "Web search",
    runningLabel: "Searching the web…",
  },
  [TOOL_NAMES.createArtifact]: {
    label: "Artifact",
    runningLabel: "Creating artifact…",
  },
  [TOOL_NAMES.memorySearch]: {
    label: "Memory",
    runningLabel: "Searching memory…",
  },
  [TOOL_NAMES.memoryWrite]: {
    label: "Memory",
    runningLabel: "Saving memory…",
  },
  [TOOL_NAMES.driveSearch]: {
    label: "Drive",
    runningLabel: "Searching Drive…",
  },
  [TOOL_NAMES.driveRead]: {
    label: "Drive",
    runningLabel: "Reading Drive file…",
  },
  [TOOL_NAMES.githubGetRepo]: {
    label: "GitHub",
    runningLabel: "Looking up repository…",
  },
  [TOOL_NAMES.githubListContents]: {
    label: "GitHub",
    runningLabel: "Listing repository files…",
  },
  [TOOL_NAMES.githubReadFile]: {
    label: "GitHub",
    runningLabel: "Reading repository file…",
  },
  [TOOL_NAMES.fetchUrl]: {
    label: "Fetch URL",
    runningLabel: "Fetching page…",
  },
  [TOOL_NAMES.toolSearch]: {
    label: "Tool search",
    runningLabel: "Finding tools…",
  },
};

export function getToolDisplay(name: string): ToolDisplay {
  return (
    TOOL_DISPLAY[name] ?? {
      label: name,
      runningLabel: `Running ${name}…`,
    }
  );
}

/** System prompt appended to instruct the model on tool + artifact usage. */
export const TOOLS_SYSTEM_PROMPT = `You are Aether, with access to tools and an artifact panel.

Guidelines:
- Core tools are always available when tools are on:
  - "execute_python": sandboxed in-browser Python (Pyodide) for math, data, or verifying code.
  - "web_search": look up current or factual information you are unsure about.
  - "fetch_url": read a specific public page as text after you have a URL (IR pages, press releases, docs). Do NOT use fetch_url or web_search to inspect GitHub repositories — HTML scrapes of github.com are mostly chrome and miss code.
  - "create_artifact": substantial reusable content. Use kind "document" for write-ups, briefs, and docs (markdown in the artifact panel). Use "code" / "data" / "svg" / "image" when those fit better. There is no PowerPoint exporter yet — for slide-like content, prefer a structured markdown document artifact.
  - "tool_search": discover optional tools (memory, Google Drive, GitHub) by keyword when you need them. Call this before assuming those tools exist.
- Optional tools (unlocked via tool_search when the session supports them — GitHub tools may already be unlocked when the user pasted a repo link):
  - "memory_search" / "memory_write": curated long-term facts about the user.
  - "drive_search" / "drive_read": search/read the user's Google Drive when connected.
  - "github_get_repo": metadata for a connected user's repository (owner/repo or github.com URL).
  - "github_list_contents": list files/folders in a repo path.
  - "github_read_file": read a text file from a repo (README, source, config).
- When the user pastes a github.com link or asks about a repo and GitHub tools are available: call github_get_repo, then github_list_contents / github_read_file. Never fall back to Drive for a GitHub URL.
- Web research discipline (enforced):
  - Prefer 1–2 focused web_search calls, then draft. Near-duplicate queries are blocked.
  - Depth budgets also cap searches (Quick 1 / Standard 2 / Deep 3). When blocked, fetch_url or answer.
  - If results include IR / press / filing URLs, use fetch_url on the best 1–2 links before writing numbers.
  - If a search warning says results are encyclopedia-only or the budget is exhausted, deliver the brief with clear uncertainty — do not keep searching the same way.
  - Always finish with a user-visible answer even when sources are thin.
- For multi-step work, briefly narrate what you are doing before each tool call so the user can follow along.
- For short inline snippets keep them in the chat; use "create_artifact" when content is large, iterative, or meant to be reused.
- After a tool returns, incorporate its result into your answer rather than dumping raw output.
- Prefer living documents for essays and projects the user will revise across turns.
- If tools are unavailable, answer normally as a text-only assistant.`;
