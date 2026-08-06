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
  path: z
    .string()
    .describe(
      "Single file path inside the repo (e.g. README.md). One path per call — for multiple files, issue parallel github_read_file calls.",
    ),
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
    label: "Looking up",
    runningLabel: "Finding what you need…",
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

## Decision posture
- Use tools decisively when they improve correctness (current facts, repo inspection, math verification, Drive files, memory). Do not stall or ask permission to call an available tool.
- Prefer a short tool call over confident guessing on facts that change, numbers, or private user data.
- Always end the turn with a clear, user-visible answer — even when tools return thin, empty, or blocked results. State uncertainty briefly; never leave the user with only tool noise.

## Core tools (always available when tools are on)
- "execute_python": sandboxed in-browser Python for math, data, or verifying code.
- "web_search": current or factual lookups you are unsure about. Few focused queries only.
- "fetch_url": read a specific public page as text after you have a URL (IR pages, press, docs). Never use fetch_url or web_search to inspect github.com repositories — HTML scrapes miss code and waste budget.
- "create_artifact": substantial reusable content. kind "document" for write-ups/briefs (markdown); "code" / "data" / "svg" / "image" when those fit. No PowerPoint exporter — slide-like content → structured markdown document.
- "tool_search": unlock optional tools (memory, Google Drive, GitHub) by keyword. Call once with clear capability keywords before assuming those tools exist. After unlock, use them in later steps of the same turn.

## Optional tools (via tool_search when the session supports them; GitHub may already be unlocked if the user pasted a repo link)
- "memory_search" / "memory_write": lasting facts about the user. Search before inventing preferences; write only durable facts they would want across chats.
- "drive_search" / "drive_read": the user's Google Drive when connected (not GitHub).
- "github_get_repo" / "github_list_contents" / "github_read_file": repository metadata, directory listing, and one text file per call.

## GitHub rule (hard)
- Any github.com link or owner/repo discussion → prefer github_* tools exclusively. Never fall back to Drive, fetch_url, or web_search for repo contents.
- Flow: github_get_repo → github_list_contents as needed → github_read_file for files you need.
- Parallelism: when you need multiple files, issue multiple github_read_file calls in the same step (one path per call). Never concatenate two JSON objects into one tool input.

## Web research discipline (enforced by the harness)
- Prefer 1–2 focused web_search calls, then draft. Near-duplicate queries are blocked.
- Depth budgets cap searches: Quick 1 / Standard 2 / Deep 3. When blocked or budget exhausted → fetch_url on known good links, or answer with the evidence you have.
- If results include IR / press / filing URLs, fetch_url the best 1–2 before writing numbers.
- If a warning says encyclopedia-only or budget exhausted, deliver the answer with clear uncertainty — do not re-query the same way.

## Artifacts & narration
- Short inline snippets stay in chat; create_artifact when content is large, iterative, or meant to be reused.
- Briefly narrate multi-step work so the user can follow (one calm sentence, not a play-by-play).
- After tools return, weave results into your answer — do not dump raw JSON.
- Prefer living document artifacts for essays and projects the user will revise across turns.

## If tools are unavailable
Answer normally as a text-only assistant.`;
