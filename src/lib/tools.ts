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
  /** Structured verify pass for deep / substantial work. */
  verifyChecklist: "verify_checklist",
  /** Gate side effects until the user approves. */
  requestConfirmation: "request_confirmation",
  /** Open / extract a public page (fetch or Browserless). */
  browserNavigate: "browser_navigate",
  /** Extract, preview fill, or request confirm for click/submit. */
  browserAct: "browser_act",
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
  /** Echo of body for client open when tool args were incomplete. */
  content?: string;
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

export const requestConfirmationInput = z.object({
  action: z
    .enum([
      "submit_form",
      "send_message",
      "upload_file",
      "browser_click_submit",
      "browser_fill_and_submit",
      "delete_resource",
      "other_side_effect",
    ])
    .describe("Kind of side effect that needs approval."),
  title: z.string().describe("Short title for the confirmation card."),
  preview: z
    .string()
    .describe("What will happen if the user approves (plain language)."),
  target: z
    .string()
    .optional()
    .describe("URL or resource label the action targets."),
});

export const browserNavigateInput = z.object({
  url: z.string().url().describe("Public http(s) URL to open and extract."),
});

export const browserActInput = z.object({
  url: z.string().url().describe("Page URL for the action."),
  action: z
    .enum(["extract", "fill_preview", "click", "submit"])
    .describe(
      "extract=read page; fill_preview=describe fill without applying; click/submit=side effects (submit always needs confirmation).",
    ),
  selector: z.string().optional().describe("CSS selector or field name hint."),
  value: z.string().optional().describe("Value for fill_preview."),
  description: z
    .string()
    .optional()
    .describe("Human description of the intended action."),
});

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
  [TOOL_NAMES.verifyChecklist]: {
    label: "Verify",
    runningLabel: "Checking work…",
  },
  [TOOL_NAMES.requestConfirmation]: {
    label: "Needs approval",
    runningLabel: "Waiting for approval…",
  },
  [TOOL_NAMES.browserNavigate]: {
    label: "Browser",
    runningLabel: "Opening page…",
  },
  [TOOL_NAMES.browserAct]: {
    label: "Browser",
    runningLabel: "Working on page…",
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
- "web_search": current or factual lookups. Few focused queries only.
- "fetch_url": read a public page as text (IR, press, docs). Soft-fails paywalls; PDFs best-effort. Never use for github.com repos.
- "create_artifact": substantial reusable content. kind "document" for essays/briefs; "code" / "data" / "svg" / "image" when those fit.
- "verify_checklist": structured verify pass before handing back substantial work (deep / research / write / timed drafts).
- "request_confirmation": gate any side effect (submit, send, upload) until the user approves. Never claim a side effect completed without approval.
- "browser_navigate": open a public URL and extract text (fetch or full browser when configured).
- "browser_act": extract / fill_preview / click / submit on a page. submit always returns needs_confirmation.
- "tool_search": unlock optional tools (memory, Drive, GitHub) by keyword when needed.

## Optional tools (via tool_search when the session supports them; GitHub may already be unlocked if the user pasted a repo link)
- "memory_search" / "memory_write": lasting facts about the user.
- "drive_search" / "drive_read": the user's Google Drive when connected.
- "github_get_repo" / "github_list_contents" / "github_read_file": repo tools (one path per read_file call; parallelize multiple files).

## GitHub rule (hard)
- github.com / owner-repo → github_* only. Never Drive/fetch_url/web_search for repo contents.

## Side effects & portals (hard)
- Never submit forms, send messages, or complete enrollments without request_confirmation or browser_act(submit) approval.
- If the user is logged into a portal, guide them and use extract/preview tools — never ask for passwords.
- Essay / deadline flows: draft artifact first → verify lightly → then portal steps with confirmation.

## Web research discipline (enforced by the harness)
- Prefer focused web_search calls, then draft. Near-duplicates and depth budgets apply (time budgets may tighten further).
- **Exact titles:** search the full title in quotes first (optionally + likely outlet). Do NOT invent Wired/NYT/etc. URLs and fetch them — that burns budget on 404s.
- When a search returns a real result URL, fetch_url that link. If paywalled (e.g. The Information), say so and summarize from snippets / free mirrors — don't keep re-searching the same title.
- When blocked or budget exhausted → fetch_url / browser_navigate on known links, or answer with what you have.
- Paywall / thin results → say so and finish with a usable answer.

## Artifacts & narration
- Short snippets in chat; create_artifact for long or reusable work (essays, briefs).
- Weave tool results into the answer; no raw JSON dumps.

## If tools are unavailable
Answer normally as a text-only assistant.`;
