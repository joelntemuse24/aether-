import { z } from "zod";
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
  fetchUrlInput,
  type CreateArtifactOutput,
  type WebSearchOutput,
} from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
import { searchMemories, writeMemory } from "@/lib/memory/store";
import { saveArtifact } from "@/lib/artifacts/store";
import { isCloudDbConfigured } from "@/lib/db";
import {
  driveReadTextForUser,
  driveSearchForUser,
  fetchUrlText,
} from "@/lib/connectors/web-and-drive";

export type ToolRegistryContext = {
  userId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  hasDrive?: boolean;
};

/** Build the tool set for this request (capabilities depend on auth/Drive/DB). */
export function buildToolRegistry(ctx: ToolRegistryContext): ToolSet {
  const tools: ToolSet = {
    [TOOL_NAMES.executePython]: tool({
      description:
        "Execute Python code in a sandboxed in-browser Pyodide runtime and return stdout and the final expression value. Use for math, data processing, or verifying code.",
      inputSchema: executePythonInput,
    }),
    [TOOL_NAMES.webSearch]: tool({
      description:
        "Search the web for current or factual information and return a list of result snippets.",
      inputSchema: webSearchInput,
      execute: async ({ query }): Promise<WebSearchOutput> =>
        runWebSearch(query),
    }),
    [TOOL_NAMES.createArtifact]: tool({
      description:
        "Create a rich artifact (code, document, data, image, or svg) shown in the side panel. Prefer for substantial reusable content. Persists to the user's account when signed in with cloud storage.",
      inputSchema: createArtifactInput,
      execute: async ({
        kind,
        title,
        language,
        content,
      }): Promise<CreateArtifactOutput & { id?: string; persisted?: boolean }> => {
        if (ctx.userId && isCloudDbConfigured()) {
          try {
            const saved = await saveArtifact(ctx.userId, {
              kind,
              title,
              language,
              content,
              projectId: ctx.projectId ?? undefined,
              conversationId: ctx.conversationId ?? undefined,
            });
            return { ok: true, kind, title, id: saved.id, persisted: true };
          } catch (err) {
            console.warn("[create_artifact] persist failed", err);
          }
        }
        return { ok: true, kind, title, persisted: false };
      },
    }),
    [TOOL_NAMES.fetchUrl]: tool({
      description:
        "Fetch a public http(s) URL and return extracted text (HTML stripped). Use to read a specific page after search.",
      inputSchema: fetchUrlInput,
      execute: async ({ url }) => fetchUrlText(url),
    }),
  };

  if (ctx.userId && isCloudDbConfigured()) {
    tools[TOOL_NAMES.memorySearch] = tool({
      description:
        "Search the user's curated long-term memory (preferences, people, projects, constraints). Use before assuming you know lasting facts about them.",
      inputSchema: memorySearchInput,
      execute: async ({ query }) => {
        const results = await searchMemories(ctx.userId!, query, 8);
        return { ok: true, results };
      },
    });
    tools[TOOL_NAMES.memoryWrite] = tool({
      description:
        "Write or update a lasting memory about the user (preference, person, project, constraint, writing_voice, belief_or_practice, open_question, note). Only store durable facts they would want remembered across chats.",
      inputSchema: memoryWriteInput,
      execute: async (input) => {
        const memory = await writeMemory(ctx.userId!, input);
        return { ok: true, memory };
      },
    });
  }

  if (ctx.userId && ctx.hasDrive) {
    tools[TOOL_NAMES.driveSearch] = tool({
      description:
        "Search the user's Google Drive by file name. Returns file ids for drive_read.",
      inputSchema: driveSearchInput,
      execute: async ({ query }) => driveSearchForUser(ctx.userId!, query),
    });
    tools[TOOL_NAMES.driveRead] = tool({
      description:
        "Read a Google Drive file as text (Docs/Sheets export or text-like files). Pass a file id from drive_search.",
      inputSchema: driveReadInput,
      execute: async ({ fileId }) => driveReadTextForUser(ctx.userId!, fileId),
    });
  }

  return tools;
}

/** Keep zod available for future shared schemas in this module. */
void z;
