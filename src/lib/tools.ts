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
};

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
- Use tools when they help answer accurately. Available tools:
  - "execute_python": run Python (in-browser Pyodide) for calculations, data work, or verifying code. Prefer this over guessing numeric results.
  - "web_search": look up current or factual information you are unsure about.
  - "create_artifact": produce substantial, standalone content the user will want to keep, edit, or preview — complete code files (kind "code"), long-form documents (kind "document", markdown), JSON/tabular data (kind "data"), SVG diagrams (kind "svg"), or images (kind "image").
- For multi-step work, briefly narrate what you are doing before each tool call ("Searching…", "Drafting an artifact…") so the user can follow along.
- For short inline snippets keep them in the chat; use "create_artifact" when content is large, iterative, or meant to be reused (essays, plans, codebases).
- After a tool returns, incorporate its result into your answer rather than dumping raw output.
- Prefer living documents for essays and projects the user will revise across turns.
- If tools are unavailable, answer normally as a text-only assistant.`;
