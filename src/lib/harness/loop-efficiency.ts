/**
 * Agent-loop efficiency helpers inspired by ChatGPT/Codex harness practice:
 * - Stable tool order (prompt-cache friendly prefixes)
 * - Deferred tool discovery (core tools + tool_search)
 * - Hard per-turn web_search quotas + near-duplicate rejection
 *
 * See: https://blog.bytebytego.com/p/how-chatgpt-optimizes-its-agent-loop
 */

import type { HarnessDepth } from "./types";
import { TOOL_NAMES, type WebSearchOutput } from "@/lib/tools";

/** Always exposed when tools are on (plus tool_search when deferred tools exist). */
export const CORE_TOOL_ORDER = [
  TOOL_NAMES.executePython,
  TOOL_NAMES.webSearch,
  TOOL_NAMES.fetchUrl,
  TOOL_NAMES.createArtifact,
  TOOL_NAMES.toolSearch,
] as const;

/** Loaded into the prompt only after tool_search unlocks them. */
export const DEFERRED_TOOL_ORDER = [
  TOOL_NAMES.memorySearch,
  TOOL_NAMES.memoryWrite,
  TOOL_NAMES.driveSearch,
  TOOL_NAMES.driveRead,
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
] as const;

const DEFERRED_SET = new Set<string>(DEFERRED_TOOL_ORDER);

export type ToolCatalogEntry = {
  name: string;
  description: string;
  keywords: string[];
};

const CATALOG: Record<string, Omit<ToolCatalogEntry, "name">> = {
  [TOOL_NAMES.memorySearch]: {
    description:
      "Search the user's curated long-term memory (preferences, people, projects, constraints).",
    keywords: [
      "memory",
      "remember",
      "preference",
      "preferences",
      "person",
      "people",
      "constraint",
      "profile",
      "about me",
    ],
  },
  [TOOL_NAMES.memoryWrite]: {
    description:
      "Write or update a lasting memory about the user for future chats.",
    keywords: [
      "memory",
      "save",
      "remember",
      "store",
      "preference",
      "write memory",
    ],
  },
  [TOOL_NAMES.driveSearch]: {
    description: "Search the user's Google Drive by file name.",
    keywords: [
      "drive",
      "google drive",
      "files",
      "document",
      "docs",
      "spreadsheet",
      "gdrive",
    ],
  },
  [TOOL_NAMES.driveRead]: {
    description: "Read a Google Drive file as text by file id.",
    keywords: [
      "drive",
      "google drive",
      "read file",
      "open file",
      "document",
      "docs",
    ],
  },
  [TOOL_NAMES.githubGetRepo]: {
    description:
      "Get metadata for a GitHub repository the user can access (owner/repo or github.com URL).",
    keywords: [
      "github",
      "repo",
      "repository",
      "codebase",
      "pull request",
      "gh",
    ],
  },
  [TOOL_NAMES.githubListContents]: {
    description: "List files and folders in a GitHub repository path.",
    keywords: [
      "github",
      "repo",
      "repository",
      "files",
      "folder",
      "directory",
      "tree",
      "list files",
      "codebase",
    ],
  },
  [TOOL_NAMES.githubReadFile]: {
    description: "Read a text file from a GitHub repository by path.",
    keywords: [
      "github",
      "repo",
      "repository",
      "read file",
      "source",
      "readme",
      "code",
      "blob",
    ],
  },
};

const QUERY_STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "about",
  "from",
  "tool",
  "tools",
  "find",
  "get",
  "use",
  "need",
  "want",
  "please",
  "my",
  "me",
  "user",
]);

export function webSearchBudgetForDepth(depth: HarnessDepth): number {
  if (depth === "shallow") return 1;
  if (depth === "deep") return 3;
  return 2;
}

export function normalizeSearchQuery(query: string): string {
  const expanded = query
    .toLowerCase()
    // FY2024 / fy24 → keep a bare year token for overlap.
    .replace(/\bfy\s*(20\d{2})\b/gi, "$1")
    .replace(/\bfy\s*(\d{2})\b/gi, "20$1")
    .replace(/[^a-z0-9\s+-]/g, " ");
  return expanded
    .split(/\s+/)
    .filter((t) => t.length > 2 && !QUERY_STOP.has(t))
    .sort()
    .join(" ");
}

/** Jaccard / containment overlap — catches near-duplicate research queries. */
export function isNearDuplicateQuery(a: string, b: string): boolean {
  const na = normalizeSearchQuery(a);
  const nb = normalizeSearchQuery(b);
  if (!na || !nb) return a.trim().toLowerCase() === b.trim().toLowerCase();
  if (na === nb) return true;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  if (union <= 0) return false;
  const jaccard = inter / union;
  if (jaccard >= 0.5) return true;
  // One query mostly contained in the other (common with "broader → narrower" loops).
  const smaller = Math.min(ta.size, tb.size);
  if (smaller >= 3 && inter / smaller >= 0.8) return true;
  return false;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !QUERY_STOP.has(t));
}

/** Lightweight lexical rank (BM25-flavored) over deferred tool descriptions. */
export function rankDeferredTools(
  availableNames: readonly string[],
  query: string,
): ToolCatalogEntry[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const scored: Array<ToolCatalogEntry & { score: number }> = [];
  for (const name of availableNames) {
    if (!DEFERRED_SET.has(name)) continue;
    const meta = CATALOG[name];
    if (!meta) continue;
    const hay = tokenize(
      `${name.replace(/_/g, " ")} ${meta.description} ${meta.keywords.join(" ")}`,
    );
    const df = new Map<string, number>();
    for (const t of hay) df.set(t, (df.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qTokens) {
      const tf = df.get(qt) ?? 0;
      if (tf > 0) score += 1 + Math.log(1 + tf);
      // Prefix / substring bonus for short tool names.
      if (name.includes(qt) || meta.keywords.some((k) => k.includes(qt))) {
        score += 1.5;
      }
    }
    if (score > 0) {
      scored.push({
        name,
        description: meta.description,
        keywords: meta.keywords,
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(({ name, description, keywords }) => ({ name, description, keywords }));
}

export type ToolSearchOutput = {
  ok: boolean;
  query: string;
  unlocked: Array<{ name: string; description: string }>;
  note?: string;
};

export type AgentLoopController = {
  /** Stable order for every step (cache-friendly). */
  toolOrder: string[];
  /** Tools the model may see on the first step. */
  initialActiveTools: string[];
  prepareStep: () => {
    activeTools: string[];
    toolOrder: string[];
  };
  runToolSearch: (query: string) => ToolSearchOutput;
  /**
   * Gate web_search. Returns an error-shaped output to short-circuit, or null
   * to proceed with the real search.
   */
  gateWebSearch: (query: string) => WebSearchOutput | null;
  webSearchBudget: number;
};

export function createAgentLoopController(input: {
  depth: HarnessDepth;
  /** Tool names present in this request's registry. */
  availableToolNames: readonly string[];
  /**
   * Deferred tools to unlock on step 0 (e.g. GitHub tools when the user
   * pasted a github.com link — skip tool_search discovery).
   */
  seedUnlocked?: readonly string[];
}): AgentLoopController {
  const available = [...input.availableToolNames];
  const availableSet = new Set(available);
  const deferredAvailable = DEFERRED_TOOL_ORDER.filter((n) =>
    availableSet.has(n),
  );
  const hasDeferred = deferredAvailable.length > 0;
  const unlocked = new Set<string>();
  const deferredSet = new Set<string>(deferredAvailable);
  for (const name of input.seedUnlocked ?? []) {
    if (deferredSet.has(name)) unlocked.add(name);
  }
  const priorQueries: string[] = [];
  const webSearchBudget = webSearchBudgetForDepth(input.depth);

  const toolOrder = [...CORE_TOOL_ORDER, ...DEFERRED_TOOL_ORDER].filter((n) => {
    if (n === TOOL_NAMES.toolSearch) return hasDeferred;
    return availableSet.has(n);
  });

  const coreActive = CORE_TOOL_ORDER.filter((n) => {
    if (n === TOOL_NAMES.toolSearch) return hasDeferred;
    return availableSet.has(n);
  });

  const activeTools = (): string[] => {
    const deferred = deferredAvailable.filter((n) => unlocked.has(n));
    // Stable order: core first, then unlocked deferred in catalog order.
    return [...coreActive, ...deferred];
  };

  return {
    toolOrder,
    initialActiveTools: activeTools(),
    webSearchBudget,
    prepareStep: () => ({
      activeTools: activeTools(),
      toolOrder,
    }),
    runToolSearch: (query: string): ToolSearchOutput => {
      const trimmed = query.trim();
      if (!trimmed) {
        return {
          ok: false,
          query,
          unlocked: [],
          note: "Empty tool search query.",
        };
      }
      if (!hasDeferred) {
        return {
          ok: true,
          query: trimmed,
          unlocked: [],
          note: "No deferred tools are available in this session.",
        };
      }
      const matches = rankDeferredTools(deferredAvailable, trimmed).slice(0, 4);
      for (const m of matches) unlocked.add(m.name);
      return {
        ok: true,
        query: trimmed,
        unlocked: matches.map((m) => ({
          name: m.name,
          description: m.description,
        })),
        note:
          matches.length === 0
            ? "No matching tools. Core tools (web_search, fetch_url, create_artifact, execute_python) are already available."
            : `Unlocked ${matches.length} tool(s) for subsequent steps.`,
      };
    },
    gateWebSearch: (query: string): WebSearchOutput | null => {
      const trimmed = query.trim();
      if (!trimmed) {
        return {
          ok: false,
          query,
          results: [],
          error: "Empty search query.",
        };
      }
      if (priorQueries.some((p) => isNearDuplicateQuery(p, trimmed))) {
        return {
          ok: false,
          query: trimmed,
          results: [],
          error:
            "Near-duplicate web_search blocked. Use a meaningfully different query, fetch_url on a known link, or draft the answer now.",
          warning:
            "Search loop guard: repeated similar queries waste steps. Finish with the evidence you have.",
        };
      }
      if (priorQueries.length >= webSearchBudget) {
        return {
          ok: false,
          query: trimmed,
          results: [],
          error: `web_search budget exhausted for this turn (${webSearchBudget} max at ${input.depth} depth). Use fetch_url or answer now.`,
          warning:
            "Search budget reached. Draft the answer from existing results rather than searching again.",
        };
      }
      priorQueries.push(trimmed);
      return null;
    },
  };
}
