/**
 * Aether-owned tool dispatcher for the hosted path.
 * Executes memory / artifacts / Drive / GitHub / confirmations on Vercel
 * with the user's session. Not a streamText ToolSet.
 */

import { saveArtifact } from "@/lib/artifacts/store";
import {
  driveReadTextForUser,
  driveSearchForUser,
} from "@/lib/connectors/web-and-drive";
import {
  githubGetRepoForUser,
  githubListContentsForUser,
  githubReadFileForUser,
} from "@/lib/connectors/github";
import {
  createConfirmationRequest,
  type ConfirmationRequest,
  type ConfirmationToolResult,
} from "@/lib/harness/confirmation";
import { isCloudDbConfigured } from "@/lib/db";
import { searchMemories, writeMemory } from "@/lib/memory/store";
import { TOOL_NAMES } from "@/lib/tools";
import {
  parseToolApprovalMode,
  shouldConfirmAetherTool,
  type ToolApprovalMode,
} from "./tool-approval";

export type AetherToolName = string;

export type AetherToolDeps = {
  searchMemories?: (
    userId: string,
    query: string,
    limit?: number,
  ) => Promise<unknown[]>;
  writeMemory?: (
    userId: string,
    input: {
      id?: string;
      type?: string;
      title: string;
      body: string;
      importance?: string;
      tags?: string[];
    },
  ) => Promise<unknown>;
  saveArtifact?: (
    userId: string,
    input: {
      kind: string;
      title: string;
      language?: string;
      content: string;
      projectId?: string;
      conversationId?: string;
    },
  ) => Promise<{ id: string }>;
  driveSearch?: (
    userId: string,
    query: string,
    accessToken?: string,
  ) => Promise<unknown>;
  driveRead?: (
    userId: string,
    fileId: string,
    accessToken?: string,
  ) => Promise<unknown>;
  githubGetRepo?: (
    userId: string,
    repo: string,
    accessToken?: string,
  ) => Promise<unknown>;
  githubListContents?: (
    userId: string,
    repo: string,
    path?: string,
    ref?: string,
    accessToken?: string,
  ) => Promise<unknown>;
  githubReadFile?: (
    userId: string,
    repo: string,
    path: string,
    ref?: string,
    accessToken?: string,
  ) => Promise<unknown>;
  createConfirmation?: (
    request: ConfirmationRequest,
    userId?: string | null,
  ) => Promise<ConfirmationToolResult>;
};

export type AetherToolContext = {
  userId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  approvalMode: ToolApprovalMode;
  hasMemory?: boolean;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  driveAccessToken?: string;
  githubAccessToken?: string;
  skipGate?: boolean;
  deps?: AetherToolDeps;
};

export type AetherToolResult = {
  ok: boolean;
  error?: string;
  needs_confirmation?: boolean;
  confirmation_id?: string;
  [key: string]: unknown;
};

const AETHER_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.memorySearch,
  TOOL_NAMES.memoryWrite,
  TOOL_NAMES.createArtifact,
  TOOL_NAMES.requestConfirmation,
  TOOL_NAMES.driveSearch,
  TOOL_NAMES.driveRead,
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
]);

export function isAetherOwnedToolName(name: string): boolean {
  return AETHER_TOOL_NAMES.has(name);
}

export function resolveAetherToolContextFlags(ctx: {
  userId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
}): { hasMemory: boolean; hasDrive: boolean; hasGitHub: boolean } {
  return {
    hasMemory: !!(ctx.userId && isCloudDbConfigured()),
    hasDrive: !!(ctx.userId && ctx.hasDrive),
    hasGitHub: !!(ctx.userId && ctx.hasGitHub),
  };
}

function asRecord(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function wrapConnectorResult(out: unknown): AetherToolResult {
  if (out && typeof out === "object") {
    const rec = out as { ok?: boolean };
    if (typeof rec.ok === "boolean") return out as AetherToolResult;
    return { ok: true, ...rec };
  }
  return { ok: true, result: out };
}

function confirmActionForTool(name: string): ConfirmationRequest["action"] {
  if (name.includes("delete")) return "delete_resource";
  if (name === TOOL_NAMES.createArtifact) return "other_side_effect";
  if (name === TOOL_NAMES.memoryWrite) return "other_side_effect";
  return "other_side_effect";
}

async function gateIfNeeded(
  name: string,
  args: Record<string, unknown>,
  ctx: AetherToolContext,
): Promise<AetherToolResult | null> {
  if (
    !shouldConfirmAetherTool({
      name,
      args,
      mode: parseToolApprovalMode(ctx.approvalMode),
      skipGate: ctx.skipGate,
    })
  ) {
    return null;
  }
  const create =
    ctx.deps?.createConfirmation ??
    ((request: ConfirmationRequest, userId?: string | null) =>
      createConfirmationRequest(request, userId, {
        conversationId: ctx.conversationId,
        runId: ctx.runId,
      }));
  const title =
    str(args.title) ||
    (name === TOOL_NAMES.memoryWrite
      ? "Save a memory"
      : name === TOOL_NAMES.createArtifact
        ? "Save an artifact"
        : "Needs approval");
  const preview =
    str(args.preview) ||
    (name === TOOL_NAMES.memoryWrite
      ? `Save memory “${str(args.title) || "untitled"}” to your Aether account.`
      : name === TOOL_NAMES.createArtifact
        ? `Create artifact “${str(args.title) || "untitled"}”.`
        : str(args.title) || name);
  const action =
    (typeof args.action === "string" &&
    [
      "submit_form",
      "send_message",
      "upload_file",
      "browser_click_submit",
      "browser_fill_and_submit",
      "delete_resource",
      "other_side_effect",
    ].includes(args.action)
      ? args.action
      : confirmActionForTool(name)) as ConfirmationRequest["action"];
  const conf = await create(
    {
      action,
      title: title.slice(0, 120) || "Needs approval",
      preview: preview.slice(0, 2000) || "This action needs your approval.",
      target: str(args.target) || undefined,
      payload: {
        tool: name,
        args,
        projectId: ctx.projectId ?? null,
      },
    },
    ctx.userId,
  );
  return {
    ok: true,
    needs_confirmation: true,
    confirmation_id: conf.confirmation_id,
    action: conf.action,
    title: conf.title,
    preview: conf.preview,
    instruction: conf.instruction,
  };
}

export async function executeAetherTool(input: {
  name: string;
  args?: unknown;
  ctx: AetherToolContext;
}): Promise<AetherToolResult> {
  const name = input.name;
  const args = asRecord(input.args);
  const ctx = input.ctx;

  if (!isAetherOwnedToolName(name)) {
    return { ok: false, error: `Unknown Aether tool: ${name}` };
  }

  const gated = await gateIfNeeded(name, args, ctx);
  if (gated) return gated;

  if (name === TOOL_NAMES.requestConfirmation) {
    const create =
      ctx.deps?.createConfirmation ??
      ((request: ConfirmationRequest, userId?: string | null) =>
        createConfirmationRequest(request, userId, {
          conversationId: ctx.conversationId,
          runId: ctx.runId,
        }));
    const action = str(args.action) || "other_side_effect";
    const conf = await create(
      {
        action: action as ConfirmationRequest["action"],
        title: (str(args.title) || "Needs approval").slice(0, 120),
        preview: (str(args.preview) || "This action needs your approval.").slice(
          0,
          2000,
        ),
        target: str(args.target) || undefined,
        payload: asRecord(args.payload),
      },
      ctx.userId,
    );
    return { ...conf };
  }

  if (name === TOOL_NAMES.memorySearch) {
    if (!ctx.userId || !ctx.hasMemory) {
      return { ok: false, error: "Memory is not connected." };
    }
    const search = ctx.deps?.searchMemories ?? searchMemories;
    const results = await search(ctx.userId, str(args.query), 8);
    return { ok: true, results };
  }

  if (name === TOOL_NAMES.memoryWrite) {
    if (!ctx.userId || !ctx.hasMemory) {
      return { ok: false, error: "Memory is not connected." };
    }
    const title = str(args.title);
    const body = str(args.body);
    if (!title || !body) {
      return { ok: false, error: "title and body are required." };
    }
    const write = ctx.deps?.writeMemory ?? writeMemory;
    const memory = await write(ctx.userId, {
      id: str(args.id) || undefined,
      type: str(args.type) || undefined,
      title,
      body,
      importance: str(args.importance) || undefined,
      tags: Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === "string")
        : undefined,
    });
    return { ok: true, memory };
  }

  if (name === TOOL_NAMES.createArtifact) {
    const kind = str(args.kind) || "document";
    const title = str(args.title);
    const content = str(args.content);
    if (!title || !content) {
      return { ok: false, error: "title and content are required." };
    }
    if (ctx.userId && isCloudDbConfigured()) {
      try {
        const save = ctx.deps?.saveArtifact ?? saveArtifact;
        const saved = await save(ctx.userId, {
          kind,
          title,
          language: str(args.language) || undefined,
          content,
          projectId: ctx.projectId ?? undefined,
          conversationId: ctx.conversationId ?? undefined,
        });
        return {
          ok: true,
          kind,
          title,
          id: saved.id,
          persisted: true,
          content,
        };
      } catch (err) {
        console.warn("[create_artifact] persist failed", err);
      }
    }
    return { ok: true, kind, title, persisted: false, content };
  }

  if (name === TOOL_NAMES.driveSearch) {
    if (!ctx.userId || !ctx.hasDrive) {
      return { ok: false, error: "Google Drive is not connected." };
    }
    const search = ctx.deps?.driveSearch ?? driveSearchForUser;
    const out = await search(ctx.userId, str(args.query), ctx.driveAccessToken);
    return wrapConnectorResult(out);
  }

  if (name === TOOL_NAMES.driveRead) {
    if (!ctx.userId || !ctx.hasDrive) {
      return { ok: false, error: "Google Drive is not connected." };
    }
    const read = ctx.deps?.driveRead ?? driveReadTextForUser;
    const out = await read(ctx.userId, str(args.fileId), ctx.driveAccessToken);
    return wrapConnectorResult(out);
  }

  if (name === TOOL_NAMES.githubGetRepo) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    const getRepo = ctx.deps?.githubGetRepo ?? githubGetRepoForUser;
    const out = await getRepo(ctx.userId, str(args.repo), ctx.githubAccessToken);
    return wrapConnectorResult(out);
  }

  if (name === TOOL_NAMES.githubListContents) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    const list = ctx.deps?.githubListContents ?? githubListContentsForUser;
    const out = await list(
      ctx.userId,
      str(args.repo),
      str(args.path) || undefined,
      str(args.ref) || undefined,
      ctx.githubAccessToken,
    );
    return wrapConnectorResult(out);
  }

  if (name === TOOL_NAMES.githubReadFile) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    const read = ctx.deps?.githubReadFile ?? githubReadFileForUser;
    const out = await read(
      ctx.userId,
      str(args.repo),
      str(args.path),
      str(args.ref) || undefined,
      ctx.githubAccessToken,
    );
    return wrapConnectorResult(out);
  }

  return { ok: false, error: `Aether tool is not available: ${name}` };
}
