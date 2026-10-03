/**
 * Tools the native engine can actually run.
 * Web tools execute on the VM. Account tools execute on Vercel.
 * Names outside this list are not attached, even if a token mentions them.
 */

import {
  browsePageInput,
  createArtifactInput,
  currentTimeInput,
  driveReadInput,
  driveSearchInput,
  fetchUrlInput,
  githubGetRepoInput,
  githubListContentsInput,
  githubListIssuesInput,
  githubReadFileInput,
  memorySearchInput,
  memoryWriteInput,
  projectKnowledgeSearchInput,
  webSearchInput,
} from "@/lib/tools";
import type { AgentToolDefinition } from "./registry";

export const NATIVE_WEB_TOOL_NAMES = [
  "web_search",
  "fetch_url",
  "browse_page",
  "current_time",
] as const;

export const NATIVE_ACCOUNT_TOOL_NAMES = [
  "memory_search",
  "memory_write",
  "create_artifact",
  "project_knowledge_search",
  "drive_search",
  "drive_read",
  "github_get_repo",
  "github_read_file",
  "github_list_contents",
  "github_list_issues",
] as const;

const CATALOG: readonly AgentToolDefinition[] = [
  {
    name: "web_search",
    description: "Search the web. Use for live facts such as weather, news, and prices.",
    inputSchema: webSearchInput,
    timeoutMs: 30_000,
    risk: "read",
    runsOn: "vm",
    requiresAuth: false,
  },
  {
    name: "fetch_url",
    description: "Fetch a public http(s) page as text.",
    inputSchema: fetchUrlInput,
    timeoutMs: 25_000,
    risk: "read",
    runsOn: "vm",
    requiresAuth: false,
  },
  {
    name: "browse_page",
    description: "Read a public page and return a short structured extract.",
    inputSchema: browsePageInput,
    timeoutMs: 90_000,
    risk: "read",
    runsOn: "vm",
    requiresAuth: false,
  },
  {
    name: "current_time",
    description: "Current time in an IANA timezone. Example: Europe/Dublin.",
    inputSchema: currentTimeInput,
    timeoutMs: 5_000,
    risk: "read",
    runsOn: "vm",
    requiresAuth: false,
  },
  {
    name: "memory_search",
    description: "Search the signed-in user's saved memory.",
    inputSchema: memorySearchInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "memory_write",
    description: "Save a memory. Waits for approval before writing.",
    inputSchema: memoryWriteInput,
    timeoutMs: 20_000,
    risk: "write",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "create_artifact",
    description: "Save a longer document or code block to the artifact panel.",
    inputSchema: createArtifactInput,
    timeoutMs: 20_000,
    risk: "write",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "project_knowledge_search",
    description: "Search files uploaded to the active project.",
    inputSchema: projectKnowledgeSearchInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "drive_search",
    description: "Search the user's Google Drive.",
    inputSchema: driveSearchInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "drive_read",
    description: "Read a Google Drive file as text.",
    inputSchema: driveReadInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "github_get_repo",
    description: "Look up a GitHub repository.",
    inputSchema: githubGetRepoInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "github_read_file",
    description: "Read one file from a GitHub repository.",
    inputSchema: githubReadFileInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "github_list_contents",
    description: "List files in a GitHub repository path.",
    inputSchema: githubListContentsInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
  {
    name: "github_list_issues",
    description: "List issues on a GitHub repository.",
    inputSchema: githubListIssuesInput,
    timeoutMs: 20_000,
    risk: "read",
    runsOn: "vercel",
    requiresAuth: true,
  },
];

const BY_NAME = new Map(CATALOG.map((definition) => [definition.name, definition]));

export function nativeToolNames(includeAccount: boolean): string[] {
  return includeAccount
    ? [...NATIVE_WEB_TOOL_NAMES, ...NATIVE_ACCOUNT_TOOL_NAMES]
    : [...NATIVE_WEB_TOOL_NAMES];
}

/** Keep allow-list order. Skip names this process cannot run. */
export function definitionsForAllowList(names: readonly string[]): AgentToolDefinition[] {
  const definitions: AgentToolDefinition[] = [];
  for (const name of names) {
    const definition = BY_NAME.get(name);
    if (definition) definitions.push(definition);
  }
  return definitions;
}

export function isNativeAccountTool(name: string): boolean {
  return (NATIVE_ACCOUNT_TOOL_NAMES as readonly string[]).includes(name);
}
