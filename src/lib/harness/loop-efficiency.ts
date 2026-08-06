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
  TOOL_NAMES.verifyChecklist,
  TOOL_NAMES.requestConfirmation,
  TOOL_NAMES.browserNavigate,
  TOOL_NAMES.browserAct,
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

const GITHUB_TOOL_NAMES = [
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
] as const;

export type ToolCatalogEntry = {
  name: string;
  description: string;
  keywords: string[];
};

/** Sibling suites — unlocking one tool unlocks the whole capability set. */
const DEFERRED_SUITES: ReadonlyArray<readonly string[]> = [
  [TOOL_NAMES.memorySearch, TOOL_NAMES.memoryWrite],
  [TOOL_NAMES.driveSearch, TOOL_NAMES.driveRead],
  [
    TOOL_NAMES.githubGetRepo,
    TOOL_NAMES.githubListContents,
    TOOL_NAMES.githubReadFile,
  ],
];

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
      "what do you know",
      "recall",
      "saved",
      "long term",
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
      "note that",
      "from now on",
      "always",
      "don't forget",
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
      "slides",
      "sheet",
      "my drive",
      "google doc",
      "google sheet",
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
      "slides",
      "sheet",
      "gdrive",
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
      "github.com",
      "clone",
      "branch",
      "commit",
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
      "github.com",
      "structure",
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
      "github.com",
      "package.json",
      "tsconfig",
    ],
  },
};

/** Soft domain tokens → suite when lexical rank returns nothing useful. */
const DOMAIN_FALLBACKS: ReadonlyArray<{
  patterns: RegExp;
  suite: readonly string[];
}> = [
  {
    patterns:
      /\b(memory|remember|preference|preferences|about me|recall|don'?t forget|from now on)\b/i,
    suite: [TOOL_NAMES.memorySearch, TOOL_NAMES.memoryWrite],
  },
  {
    patterns:
      /\b(drive|gdrive|google\s*drive|google\s*doc|spreadsheet|slides?)\b/i,
    suite: [TOOL_NAMES.driveSearch, TOOL_NAMES.driveRead],
  },
  {
    patterns:
      /\b(github|gh\.com|github\.com|repository|codebase|pull request|\brepo\b)\b/i,
    suite: GITHUB_TOOL_NAMES,
  },
];

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
  // Deep research needs headroom for title + outlet + follow-up (not 1–2 guesses).
  if (depth === "deep") return 5;
  return 3;
}

/** Optional tighter cap from time pressure ("5 minutes"). */
export function webSearchBudgetWithTimeCap(
  depth: HarnessDepth,
  timeMaxSearches?: number | null,
): number {
  const base = webSearchBudgetForDepth(depth);
  if (timeMaxSearches == null || timeMaxSearches <= 0) return base;
  return Math.max(1, Math.min(base, timeMaxSearches));
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

/** Expand matched tools to their full capability suite (read+write, etc.). */
export function expandDeferredSuites(
  matchedNames: readonly string[],
  availableNames: readonly string[],
): string[] {
  const available = new Set(availableNames);
  const out = new Set<string>();
  for (const name of matchedNames) {
    if (!available.has(name) || !DEFERRED_SET.has(name)) continue;
    out.add(name);
    for (const suite of DEFERRED_SUITES) {
      if (suite.includes(name)) {
        for (const sibling of suite) {
          if (available.has(sibling)) out.add(sibling);
        }
      }
    }
  }
  return DEFERRED_TOOL_ORDER.filter((n) => out.has(n));
}

/** Lightweight lexical rank (BM25-flavored) over deferred tool descriptions. */
export function rankDeferredTools(
  availableNames: readonly string[],
  query: string,
): ToolCatalogEntry[] {
  const qTokens = tokenize(query);
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
    // Phrase hits on multi-word keywords (e.g. "google drive", "about me").
    const qLower = query.toLowerCase();
    for (const kw of meta.keywords) {
      if (kw.includes(" ") && qLower.includes(kw)) score += 2.5;
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

  let ranked = scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(({ name, description, keywords }) => ({ name, description, keywords }));

  // Domain fallback when lexical rank is empty — still unlock the right suite.
  if (ranked.length === 0 && query.trim()) {
    const available = new Set(availableNames);
    const fallbackNames: string[] = [];
    for (const fb of DOMAIN_FALLBACKS) {
      if (fb.patterns.test(query)) {
        for (const n of fb.suite) {
          if (available.has(n)) fallbackNames.push(n);
        }
      }
    }
    ranked = fallbackNames.map((name) => {
      const meta = CATALOG[name]!;
      return {
        name,
        description: meta.description,
        keywords: meta.keywords,
      };
    });
  }

  // Always expand suites so memory_search also unlocks memory_write, etc.
  const expanded = expandDeferredSuites(
    ranked.map((r) => r.name),
    availableNames,
  );
  return expanded.map((name) => {
    const fromRank = ranked.find((r) => r.name === name);
    if (fromRank) return fromRank;
    const meta = CATALOG[name]!;
    return {
      name,
      description: meta.description,
      keywords: meta.keywords,
    };
  });
}

/**
 * Deferred tools that should be active on step 0 — without waiting for
 * tool_search. Used when:
 * - the thread already invoked those tools (esp. continue segments), or
 * - the conversation mentions a GitHub repo and GitHub tools are available, or
 * - the latest user text clearly needs memory / Drive (soft seed).
 *
 * Continue turns send CONTINUE_USER_TEXT as the latest user message, which
 * does not mention github.com — so seeding from lastUserText alone drops
 * GitHub tools and causes AI_NoSuchToolError on resume.
 */
export function collectSeedUnlockedToolNames(input: {
  messages: ReadonlyArray<{
    role?: string;
    parts?: ReadonlyArray<{ type?: string; text?: string; toolName?: string }>;
  }>;
  availableToolNames: readonly string[];
  /** True when any message text mentions a github.com repo / owner/repo. */
  mentionsGitHubRepo: boolean;
  /**
   * Optional free text (usually last user message or full thread) used to
   * soft-seed memory/Drive suites so tool_search is not mandatory.
   */
  intentText?: string;
}): string[] {
  const available = new Set(input.availableToolNames);
  const seeds = new Set<string>();

  for (const msg of input.messages) {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    for (const part of parts) {
      if (!part || typeof part.type !== "string") continue;
      // AI SDK UI tool parts: `tool-<name>`
      if (part.type.startsWith("tool-")) {
        const name = part.type.slice("tool-".length);
        if (DEFERRED_SET.has(name) && available.has(name)) {
          seeds.add(name);
        }
        continue;
      }
      // Some histories may carry dynamic tool parts with toolName.
      if (
        part.type === "dynamic-tool" &&
        typeof part.toolName === "string" &&
        DEFERRED_SET.has(part.toolName) &&
        available.has(part.toolName)
      ) {
        seeds.add(part.toolName);
      }
    }
  }

  if (input.mentionsGitHubRepo) {
    for (const name of GITHUB_TOOL_NAMES) {
      if (available.has(name)) seeds.add(name);
    }
  }

  // Soft seed from intent text (memory / drive) without requiring tool_search.
  if (input.intentText?.trim()) {
    for (const fb of DOMAIN_FALLBACKS) {
      if (!fb.patterns.test(input.intentText)) continue;
      for (const n of fb.suite) {
        if (available.has(n)) seeds.add(n);
      }
    }
  }

  // Expand any partial suite seeds (e.g. only github_get_repo used → full suite).
  return expandDeferredSuites([...seeds], input.availableToolNames);
}

/** Flatten text parts across the thread (for GitHub-link detection). */
export function collectMessageText(
  messages: ReadonlyArray<{
    parts?: ReadonlyArray<{ type?: string; text?: string }>;
  }>,
): string {
  const chunks: string[] = [];
  for (const msg of messages) {
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string" && part.text) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n");
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
  /** Optional tighter web_search cap from time-pressure budget. */
  maxWebSearches?: number | null;
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
  const webSearchBudget = webSearchBudgetWithTimeCap(
    input.depth,
    input.maxWebSearches,
  );

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
      // rankDeferredTools expands suites; cap keeps the active set bounded.
      const matches = rankDeferredTools(deferredAvailable, trimmed).slice(0, 6);
      for (const m of matches) unlocked.add(m.name);
      // Re-list everything currently unlocked that matched this query's suite
      // so the model sees the full capability set in the tool result.
      const newlyOrAlready = deferredAvailable
        .filter((n) => unlocked.has(n) && matches.some((m) => m.name === n))
        .map((name) => {
          const meta = CATALOG[name]!;
          return { name, description: meta.description };
        });
      return {
        ok: true,
        query: trimmed,
        unlocked: newlyOrAlready,
        note:
          newlyOrAlready.length === 0
            ? "No matching optional tools. Try keywords like 'memory', 'drive', or 'github'. Core tools (web_search, fetch_url, create_artifact, execute_python) are already available."
            : `Unlocked ${newlyOrAlready.length} tool(s) for subsequent steps. Call them now if needed.`,
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
