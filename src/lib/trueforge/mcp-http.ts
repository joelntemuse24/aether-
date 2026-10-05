import { executeAetherTool } from "@/lib/hermes/aether-tools";
import { browsePage } from "@/lib/connectors/browse-page";
import { fetchUrlText } from "@/lib/connectors/web-and-drive";
import { resolveCurrentTime } from "@/lib/current-time";
import { TOOL_NAMES } from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
import { connectorTokensForToolCall } from "./connector-tokens";
import type { TrueForgeToolContext } from "./tool-context";

type Json = Record<string, unknown>;

const TOOLS: { name: string; description: string; inputSchema: Json }[] = [
  {
    name: TOOL_NAMES.webSearch,
    description: "Search the web. Use for live facts such as weather, news, and prices.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query." } },
      required: ["query"],
    },
  },
  {
    name: TOOL_NAMES.fetchUrl,
    description: "Fetch a public http(s) page as text.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "http(s) URL." } },
      required: ["url"],
    },
  },
  {
    name: TOOL_NAMES.browsePage,
    description: "Read a public page and return a short structured extract.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        instructions: { type: "string" },
      },
      required: ["url"],
    },
  },
  {
    name: TOOL_NAMES.currentTime,
    description: "Current time in an IANA timezone. Example: Europe/Dublin.",
    inputSchema: {
      type: "object",
      properties: { timeZone: { type: "string" } },
    },
  },
  {
    name: TOOL_NAMES.memorySearch,
    description: "Search the signed-in user's saved memory.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: TOOL_NAMES.memoryWrite,
    description: "Save a memory. Waits for approval before writing.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" } },
      required: ["title", "body"],
    },
  },
  {
    name: TOOL_NAMES.createArtifact,
    description: "Save a longer document or code block to the artifact panel.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        language: { type: "string" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: TOOL_NAMES.driveSearch,
    description: "Search the user's Google Drive.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: TOOL_NAMES.driveRead,
    description: "Read a Google Drive file as text.",
    inputSchema: {
      type: "object",
      properties: { fileId: { type: "string" } },
      required: ["fileId"],
    },
  },
  {
    name: TOOL_NAMES.githubGetRepo,
    description: "Look up a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string", description: "owner/name" } },
      required: ["repo"],
    },
  },
  {
    name: TOOL_NAMES.githubReadFile,
    description: "Read one file from a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } },
      required: ["repo", "path"],
    },
  },
  {
    name: TOOL_NAMES.githubListContents,
    description: "List files in a GitHub repository path.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string" }, path: { type: "string" }, ref: { type: "string" } },
      required: ["repo"],
    },
  },
  {
    name: TOOL_NAMES.githubListIssues,
    description: "List issues on a GitHub repository.",
    inputSchema: {
      type: "object",
      properties: { repo: { type: "string" } },
      required: ["repo"],
    },
  },
  {
    name: TOOL_NAMES.projectKnowledgeSearch,
    description: "Search files uploaded to the active project.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

export const AETHER_MCP_TOOL_NAMES = TOOLS.map((tool) => tool.name);

/**
 * Loaded up front. TrueForge already exposes get_current_datetime (UTC), so
 * Aether's current_time is not attached.
 */
export const AETHER_MCP_DIRECT: string[] = [
  TOOL_NAMES.webSearch,
  TOOL_NAMES.fetchUrl,
  TOOL_NAMES.browsePage,
];

export const AETHER_MCP_PRELOAD = AETHER_MCP_DIRECT;

export const AETHER_MCP_DEFERRED = AETHER_MCP_TOOL_NAMES.filter(
  (name) => !AETHER_MCP_DIRECT.includes(name) && name !== TOOL_NAMES.currentTime,
);

export const TOOL_RESULT_JSON_LIMIT = 24_000;
const TRUNCATED = "[truncated]";

/** Shorten string fields until the JSON fits. Never slice the encoded string itself. */
export function toolResultJson(value: unknown, limit = TOOL_RESULT_JSON_LIMIT): string {
  const full = safeStringify(value);
  if (full.length <= limit) return full;
  if (typeof value === "string") {
    return JSON.stringify(trimText(value, Math.max(2, limit - 2)));
  }
  const current: unknown = JSON.parse(full) as unknown;
  for (let pass = 0; pass < 16; pass++) {
    const encoded = safeStringify(current);
    if (encoded.length <= limit) return encoded;
    if (!shortenLongestString(current, encoded.length - limit)) break;
  }
  const encoded = safeStringify(current);
  if (encoded.length <= limit) return encoded;
  return JSON.stringify({ ok: false, truncated: true, error: TRUNCATED });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return JSON.stringify({ ok: false, error: "Tool result could not be encoded." });
  }
}

function trimText(value: string, budget: number): string {
  if (value.length + 2 <= budget) return value;
  const room = Math.max(0, budget - TRUNCATED.length);
  return value.slice(0, room) + TRUNCATED;
}

function shortenLongestString(node: unknown, overflow: number): boolean {
  const found: {
    parent?: Record<string, unknown> | unknown[];
    key?: string | number;
    length: number;
  } = { length: 0 };
  const visit = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        if (typeof item === "string" && item.length > found.length) {
          found.parent = current;
          found.key = index;
          found.length = item.length;
        } else visit(item);
      });
      return;
    }
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (typeof item === "string" && item.length > found.length) {
        found.parent = current as Record<string, unknown>;
        found.key = key;
        found.length = item.length;
      } else visit(item);
    }
  };
  visit(node);
  if (!found.parent || found.key === undefined || found.length <= TRUNCATED.length) return false;
  const parent = found.parent as Record<string | number, unknown>;
  const current = String(parent[found.key]);
  const room = Math.max(TRUNCATED.length, current.length - overflow - 8);
  const next = current.slice(0, Math.max(0, room - TRUNCATED.length)) + TRUNCATED;
  if (next === current) return false;
  parent[found.key] = next;
  return true;
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: toolResultJson(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function toolDeadlineMs(name: string): number {
  if (name === TOOL_NAMES.browsePage) return 90_000;
  if (name === TOOL_NAMES.webSearch) return 30_000;
  if (name === TOOL_NAMES.fetchUrl) return 25_000;
  return 20_000;
}

export class ToolDeadlineError extends Error {
  constructor() {
    super("This tool took too long and was stopped. Try a narrower request.");
    this.name = "ToolDeadlineError";
  }
}

export async function withToolDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ToolDeadlineError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function liveContext(ctx: TrueForgeToolContext): Promise<TrueForgeToolContext> {
  const tokens = await connectorTokensForToolCall({
    userId: ctx.userId,
    hasDrive: ctx.hasDrive,
    hasGitHub: ctx.hasGitHub,
    readDrive: async (userId) => {
      const { getValidDriveAccessToken } = await import("@/lib/drive-session");
      return getValidDriveAccessToken(userId);
    },
    readGitHub: async (userId) => {
      const { getValidGitHubAccessToken } = await import("@/lib/github-session");
      return getValidGitHubAccessToken(userId);
    },
  });
  return {
    ...ctx,
    driveAccessToken: tokens.driveAccessToken,
    githubAccessToken: tokens.githubAccessToken,
  };
}

async function callTool(name: string, args: Json, ctx: TrueForgeToolContext | null) {
  return withToolDeadline(runTool(name, args, ctx), toolDeadlineMs(name));
}

async function runTool(name: string, args: Json, ctx: TrueForgeToolContext | null) {
  if (name === TOOL_NAMES.webSearch) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return textResult({ ok: false, error: "query is required." }, true);
    return textResult(await runWebSearch(query));
  }
  if (name === TOOL_NAMES.fetchUrl) {
    const url = typeof args.url === "string" ? args.url : "";
    return textResult(await fetchUrlText(url, { hasGitHub: ctx?.hasGitHub === true }));
  }
  if (name === TOOL_NAMES.browsePage) {
    const url = typeof args.url === "string" ? args.url : "";
    const instructions = typeof args.instructions === "string" ? args.instructions : undefined;
    return textResult(await browsePage({ url, instructions, hasGitHub: ctx?.hasGitHub === true }));
  }
  if (name === TOOL_NAMES.currentTime) {
    const timeZone = typeof args.timeZone === "string" ? args.timeZone : undefined;
    return textResult(resolveCurrentTime({ timeZone }));
  }
  if (!ctx) return textResult({ ok: false, error: "This tool needs a signed-in chat." }, true);
  const live = await liveContext(ctx);
  if (ctx.hasDrive && !live.driveAccessToken) {
    return textResult({ ok: false, error: "Google Drive needs to be connected again. Reconnect it in Settings: /?connect=drive" }, true);
  }
  if (ctx.hasGitHub && name.startsWith("github_") && !live.githubAccessToken) {
    return textResult({ ok: false, error: "GitHub needs to be connected again. Reconnect it in Settings: /?connect=github" }, true);
  }
  const result = await executeAetherTool({
    name,
    args,
    ctx: {
      userId: live.userId,
      conversationId: live.conversationId,
      projectId: live.projectId,
      runId: live.runId,
      approvalMode: live.approvalMode,
      hasMemory: live.hasMemory,
      hasDrive: live.hasDrive,
      hasGitHub: live.hasGitHub,
      driveAccessToken: live.driveAccessToken,
      githubAccessToken: live.githubAccessToken,
      skipGate: false,
    },
  });
  return textResult(result, result.ok === false);
}

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Json };

export async function handleTrueForgeMcpRpc(
  message: Rpc,
  ctx: TrueForgeToolContext | null,
): Promise<Json | null> {
  const id = message.id ?? null;
  const method = message.method ?? "";
  if (method.startsWith("notifications/")) return null;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aether", version: "1.0.0" },
      },
    };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "tools/call") {
    const params = message.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object"
        ? (params.arguments as Json)
        : {};
    try {
      return { jsonrpc: "2.0", id, result: await callTool(name, args, ctx) };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Tool failed.";
      return { jsonrpc: "2.0", id, result: textResult({ ok: false, error: messageText }, true) };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
