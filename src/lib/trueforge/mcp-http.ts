import { executeAetherTool } from "@/lib/hermes/aether-tools";
import { browsePage } from "@/lib/connectors/browse-page";
import { fetchUrlText } from "@/lib/connectors/web-and-drive";
import { resolveCurrentTime } from "@/lib/current-time";
import { TOOL_NAMES } from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
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

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value).slice(0, 24_000) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function callTool(name: string, args: Json, ctx: TrueForgeToolContext | null) {
  if (name === TOOL_NAMES.webSearch) {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return textResult({ ok: false, error: "query is required." }, true);
    return textResult(await runWebSearch(query));
  }
  if (name === TOOL_NAMES.fetchUrl) {
    const url = typeof args.url === "string" ? args.url : "";
    return textResult(await fetchUrlText(url));
  }
  if (name === TOOL_NAMES.browsePage) {
    const url = typeof args.url === "string" ? args.url : "";
    const instructions = typeof args.instructions === "string" ? args.instructions : undefined;
    return textResult(await browsePage({ url, instructions }));
  }
  if (name === TOOL_NAMES.currentTime) {
    const timeZone = typeof args.timeZone === "string" ? args.timeZone : undefined;
    return textResult(resolveCurrentTime({ timeZone }));
  }
  if (!ctx) return textResult({ ok: false, error: "This tool needs a signed-in chat." }, true);
  const result = await executeAetherTool({
    name,
    args,
    ctx: { ...ctx, skipGate: false },
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
