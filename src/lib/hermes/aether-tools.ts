/**
 * Aether-owned tool dispatcher for the hosted path.
 * Executes memory / artifacts / Drive / GitHub / confirmations on Vercel
 * with the user's session. Not a streamText ToolSet.
 */

import { saveArtifact } from "@/lib/artifacts/store";
import { searchProjectKnowledge } from "@/lib/projects/knowledge-store";
import {
  driveReadTextForUser,
  driveSearchForUser,
} from "@/lib/connectors/web-and-drive";
import {
  githubGetRepoForUser,
  githubListContentsForUser,
  githubReadFileForUser,
  githubListIssuesForUser,
  githubGetIssueForUser,
  githubListPullRequestsForUser,
  githubGetPullRequestForUser,
  githubListCommitsForUser,
  githubCreateBranchForUser,
  githubCreateOrUpdateFileForUser,
  githubCreateIssueForUser,
  githubAddIssueCommentForUser,
  githubCreatePullRequestForUser,
  githubMergePullRequestForUser,
  classifyRepoOwnership,
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
  workspaceExec,
  workspaceListFiles,
  workspaceReadBinary,
  workspaceReadFile,
  workspaceWriteFile,
} from "@/lib/connectors/workspace";
import { buildPresentationPptx } from "@/lib/office/build-pptx";
import { buildSpreadsheetXlsx } from "@/lib/office/build-xlsx";
import { buildDocumentDocx } from "@/lib/office/build-docx";
import { buildDocumentPdf } from "@/lib/office/build-pdf";
import {
  bufferToDataUrl,
  mimeForFilename,
} from "@/lib/office/file-artifact";
import { fileToolResult } from "@/lib/artifacts/file-result";
import { generateImageForUser } from "@/lib/connectors/image";
import {
  gmailSearchForUser,
  gmailReadForUser,
  gmailSendForUser,
  gmailCreateDraftForUser,
  calendarListEventsForUser,
  calendarCreateEventForUser,
  calendarDeleteEventForUser,
  contactsSearchForUser,
  contactsCreateForUser,
} from "@/lib/connectors/google";
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
  searchProjectKnowledge?: (
    userId: string,
    projectId: string,
    query: string,
    limit?: number,
  ) => Promise<unknown[]>;
  saveArtifact?: (
    userId: string,
    input: {
      kind: string;
      title: string;
      language?: string;
      content: string;
      projectId?: string;
      conversationId?: string;
      producedBy?: string[];
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
  workspaceExec?: typeof workspaceExec;
  workspaceReadFile?: typeof workspaceReadFile;
  workspaceWriteFile?: typeof workspaceWriteFile;
  workspaceListFiles?: typeof workspaceListFiles;
  workspaceReadBinary?: typeof workspaceReadBinary;
  generateImage?: typeof generateImageForUser;
  buildPresentation?: typeof buildPresentationPptx;
  buildSpreadsheet?: typeof buildSpreadsheetXlsx;
  buildDocument?: typeof buildDocumentDocx;
  buildPdf?: typeof buildDocumentPdf;
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
  hasGmail?: boolean;
  hasCalendar?: boolean;
  hasContacts?: boolean;
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
  TOOL_NAMES.projectKnowledgeSearch,
  TOOL_NAMES.createArtifact,
  TOOL_NAMES.requestConfirmation,
  TOOL_NAMES.driveSearch,
  TOOL_NAMES.driveRead,
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
  TOOL_NAMES.githubListIssues,
  TOOL_NAMES.githubGetIssue,
  TOOL_NAMES.githubListPullRequests,
  TOOL_NAMES.githubGetPullRequest,
  TOOL_NAMES.githubListCommits,
  TOOL_NAMES.githubCreateBranch,
  TOOL_NAMES.githubCreateOrUpdateFile,
  TOOL_NAMES.githubCreateIssue,
  TOOL_NAMES.githubAddIssueComment,
  TOOL_NAMES.githubCreatePullRequest,
  TOOL_NAMES.githubMergePullRequest,
  TOOL_NAMES.workspaceExec,
  TOOL_NAMES.workspaceReadFile,
  TOOL_NAMES.workspaceWriteFile,
  TOOL_NAMES.workspaceListFiles,
  TOOL_NAMES.workspacePublishFile,
  TOOL_NAMES.createPresentation,
  TOOL_NAMES.createSpreadsheet,
  TOOL_NAMES.createDocument,
  TOOL_NAMES.createPdf,
  TOOL_NAMES.generateImage,
  TOOL_NAMES.gmailSearch,
  TOOL_NAMES.gmailRead,
  TOOL_NAMES.gmailSend,
  TOOL_NAMES.gmailCreateDraft,
  TOOL_NAMES.calendarListEvents,
  TOOL_NAMES.calendarCreateEvent,
  TOOL_NAMES.calendarDeleteEvent,
  TOOL_NAMES.contactsSearch,
  TOOL_NAMES.contactsCreate,
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

/** Execute a GitHub write for a repo already classified as owned by the connected user. */
async function executeGithubWrite(
  name: string,
  args: Record<string, unknown>,
  ctx: AetherToolContext,
): Promise<AetherToolResult> {
  const repo = str(args.repo);
  const token = ctx.githubAccessToken;
  switch (name) {
    case TOOL_NAMES.githubCreateBranch:
      return wrapConnectorResult(
        await githubCreateBranchForUser(
          ctx.userId ?? "",
          repo,
          str(args.branchName),
          str(args.fromRef) || undefined,
          token,
        ),
      );
    case TOOL_NAMES.githubCreateOrUpdateFile:
      return wrapConnectorResult(
        await githubCreateOrUpdateFileForUser(
          ctx.userId ?? "",
          repo,
          str(args.path),
          str(args.content),
          str(args.commitMessage) || "Update via Aether",
          str(args.branch) || undefined,
          str(args.expectedSha) || undefined,
          token,
        ),
      );
    default:
      return { ok: false, error: `Unsupported GitHub write: ${name}` };
  }
}

/** Execute a GitHub publishing action after the user approved it. */
async function executeGithubPublish(
  name: string,
  args: Record<string, unknown>,
  ctx: AetherToolContext,
): Promise<AetherToolResult> {
  const repo = str(args.repo);
  const token = ctx.githubAccessToken;
  switch (name) {
    case TOOL_NAMES.githubCreateIssue:
      return wrapConnectorResult(
        await githubCreateIssueForUser(
          ctx.userId ?? "",
          repo,
          str(args.title),
          str(args.body) || undefined,
          token,
        ),
      );
    case TOOL_NAMES.githubAddIssueComment:
      return wrapConnectorResult(
        await githubAddIssueCommentForUser(
          ctx.userId ?? "",
          repo,
          typeof args.issueNumber === "number" ? args.issueNumber : 0,
          str(args.body),
          token,
        ),
      );
    case TOOL_NAMES.githubCreatePullRequest:
      return wrapConnectorResult(
        await githubCreatePullRequestForUser(
          ctx.userId ?? "",
          repo,
          {
            title: str(args.title),
            head: str(args.head),
            base: str(args.base),
            body: str(args.body) || undefined,
            draft: args.draft === true ? true : undefined,
          },
          token,
        ),
      );
    case TOOL_NAMES.githubMergePullRequest:
      return wrapConnectorResult(
        await githubMergePullRequestForUser(
          ctx.userId ?? "",
          repo,
          typeof args.pullNumber === "number" ? args.pullNumber : 0,
          str(args.commitTitle) || undefined,
          str(args.commitMessage) || undefined,
          args.mergeMethod === "merge" ||
            args.mergeMethod === "squash" ||
            args.mergeMethod === "rebase"
            ? args.mergeMethod
            : "squash",
          token,
        ),
      );
    default:
      return { ok: false, error: `Unsupported GitHub publish: ${name}` };
  }
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
        : "Needs your confirmation");
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
      title: title.slice(0, 120) || "Needs your confirmation",
      preview: preview.slice(0, 2000) || "This action waits for you.",
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
    payload: conf.payload ?? { tool: name, args, projectId: ctx.projectId ?? null },
  };
}

async function persistArtifact(
  ctx: AetherToolContext,
  input: {
    kind: string;
    title: string;
    language?: string;
    content: string;
    producedBy?: string[];
  },
): Promise<{ id?: string; persisted: boolean }> {
  if (!ctx.userId) {
    return { persisted: false };
  }
  const save =
    ctx.deps?.saveArtifact ??
    (isCloudDbConfigured() ? saveArtifact : null);
  if (!save) {
    return { persisted: false };
  }
  try {
    const saved = await save(ctx.userId, {
      kind: input.kind,
      title: input.title,
      language: input.language,
      content: input.content,
      projectId: ctx.projectId ?? undefined,
      conversationId: ctx.conversationId ?? undefined,
      producedBy: input.producedBy,
    });
    return { id: saved.id, persisted: true };
  } catch (err) {
    console.warn("[artifact] persist failed", err);
    return { persisted: false };
  }
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
        title: (str(args.title) || "Needs your confirmation").slice(0, 120),
        preview: (str(args.preview) || "This action waits for you.").slice(
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

  if (name === TOOL_NAMES.projectKnowledgeSearch) {
    if (!ctx.userId || !ctx.hasMemory) {
      return { ok: false, error: "Project knowledge is not connected." };
    }
    const projectId = str(args.projectId) || ctx.projectId || "";
    if (!projectId) {
      return { ok: false, error: "No active project. Bind a project to this chat first." };
    }
    const search = ctx.deps?.searchProjectKnowledge ?? searchProjectKnowledge;
    const results = await search(ctx.userId, projectId, str(args.query), 6);
    return { ok: true, projectId, results };
  }

  if (name === TOOL_NAMES.createArtifact) {
    const kind = str(args.kind) || "markdown";
    const title = str(args.title);
    const content = str(args.content);
    if (!title || !content) {
      return { ok: false, error: "title and content are required." };
    }
    const saved = await persistArtifact(ctx, {
      kind,
      title,
      language: str(args.language) || undefined,
      content,
      producedBy: [name],
    });
    return {
      ok: true,
      kind,
      title,
      id: saved.id,
      persisted: saved.persisted,
      content,
    };
  }

  const workspaceIdentity = {
    userId: ctx.userId,
    conversationId: ctx.conversationId,
  };

  if (name === TOOL_NAMES.workspaceExec) {
    const exec = ctx.deps?.workspaceExec ?? workspaceExec;
    return exec(workspaceIdentity, {
      command: str(args.command),
      timeoutMs:
        typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    });
  }

  if (name === TOOL_NAMES.workspaceReadFile) {
    const read = ctx.deps?.workspaceReadFile ?? workspaceReadFile;
    return read(workspaceIdentity, { path: str(args.path) });
  }

  if (name === TOOL_NAMES.workspaceWriteFile) {
    const write = ctx.deps?.workspaceWriteFile ?? workspaceWriteFile;
    return write(workspaceIdentity, {
      path: str(args.path),
      content: str(args.content),
    });
  }

  if (name === TOOL_NAMES.workspaceListFiles) {
    const list = ctx.deps?.workspaceListFiles ?? workspaceListFiles;
    return list(workspaceIdentity, {
      path: str(args.path) || undefined,
      depth: typeof args.depth === "number" ? args.depth : undefined,
    });
  }

  if (name === TOOL_NAMES.workspacePublishFile) {
    const pathArg = str(args.path);
    if (!pathArg) return { ok: false, error: "path is required." };
    const read = ctx.deps?.workspaceReadBinary ?? workspaceReadBinary;
    const file = await read(workspaceIdentity, { path: pathArg });
    if (!file.ok) return file;
    const filename = pathArg.split("/").filter(Boolean).pop() || "file";
    const mime = mimeForFilename(filename);
    const title = str(args.title) || filename;
    const content = bufferToDataUrl(file.buffer, mime);
    const saved = await persistArtifact(ctx, {
      kind: "file",
      title,
      language: filename,
      content,
      producedBy: [name],
    });
    return fileToolResult({
      title,
      filename,
      mime,
      bytes: file.buffer.byteLength,
      dataUrl: content,
      saved,
    });
  }

  if (name === TOOL_NAMES.createPresentation) {
    const title = str(args.title);
    const slides = Array.isArray(args.slides) ? args.slides : [];
    if (!title) return { ok: false, error: "title is required." };
    if (slides.length === 0) {
      return { ok: false, error: "slides are required." };
    }
    const build = ctx.deps?.buildPresentation ?? buildPresentationPptx;
    const deck = await build({
      title,
      subtitle: str(args.subtitle) || undefined,
      slides: slides.map((raw) => {
        const slide = asRecord(raw);
        const layout = str(slide.layout);
        return {
          title: str(slide.title),
          bullets: Array.isArray(slide.bullets)
            ? slide.bullets.filter((b): b is string => typeof b === "string")
            : undefined,
          notes: str(slide.notes) || undefined,
          layout:
            layout === "title" || layout === "section" || layout === "title_and_bullets"
              ? layout
              : undefined,
        };
      }),
    });
    const saved = await persistArtifact(ctx, {
      kind: "file",
      title,
      language: deck.filename,
      content: deck.dataUrl,
      producedBy: [name],
    });
    return fileToolResult({
      title,
      filename: deck.filename,
      mime: deck.mime,
      bytes: deck.buffer.byteLength,
      dataUrl: deck.dataUrl,
      saved,
      extra: { slides: deck.slideCount },
    });
  }

  if (name === TOOL_NAMES.createSpreadsheet) {
    const title = str(args.title);
    const sheets = Array.isArray(args.sheets) ? args.sheets : [];
    if (!title) return { ok: false, error: "title is required." };
    if (sheets.length === 0) {
      return { ok: false, error: "sheets are required." };
    }
    const build = ctx.deps?.buildSpreadsheet ?? buildSpreadsheetXlsx;
    const book = await build({
      title,
      sheets: sheets.map((raw) => {
        const sheet = asRecord(raw);
        return {
          name: str(sheet.name) || undefined,
          headers: Array.isArray(sheet.headers)
            ? sheet.headers.filter((h): h is string => typeof h === "string")
            : undefined,
          rows: Array.isArray(sheet.rows)
            ? sheet.rows.map((row) =>
                Array.isArray(row)
                  ? row.map((cell) =>
                      typeof cell === "string" ||
                      typeof cell === "number" ||
                      typeof cell === "boolean" ||
                      cell === null
                        ? cell
                        : String(cell),
                    )
                  : [],
              )
            : [],
        };
      }),
    });
    const saved = await persistArtifact(ctx, {
      kind: "file",
      title,
      language: book.filename,
      content: book.dataUrl,
      producedBy: [name],
    });
    return fileToolResult({
      title,
      filename: book.filename,
      mime: book.mime,
      bytes: book.buffer.byteLength,
      dataUrl: book.dataUrl,
      saved,
      extra: { sheets: book.sheetCount },
    });
  }

  if (name === TOOL_NAMES.createDocument) {
    const title = str(args.title);
    if (!title) return { ok: false, error: "title is required." };
    const paragraphs = Array.isArray(args.paragraphs)
      ? args.paragraphs.filter((p): p is string => typeof p === "string")
      : [];
    const build = ctx.deps?.buildDocument ?? buildDocumentDocx;
    const doc = await build({
      title,
      subtitle: str(args.subtitle) || undefined,
      paragraphs,
    });
    const saved = await persistArtifact(ctx, {
      kind: "file",
      title,
      language: doc.filename,
      content: doc.dataUrl,
      producedBy: [name],
    });
    return fileToolResult({
      title,
      filename: doc.filename,
      mime: doc.mime,
      bytes: doc.buffer.byteLength,
      dataUrl: doc.dataUrl,
      saved,
      extra: { paragraphs: doc.paragraphCount },
    });
  }

  if (name === TOOL_NAMES.createPdf) {
    const title = str(args.title);
    if (!title) return { ok: false, error: "title is required." };
    const paragraphs = Array.isArray(args.paragraphs)
      ? args.paragraphs.filter((p): p is string => typeof p === "string")
      : [];
    const build = ctx.deps?.buildPdf ?? buildDocumentPdf;
    const pdf = await build({ title, paragraphs });
    const saved = await persistArtifact(ctx, {
      kind: "file",
      title,
      language: pdf.filename,
      content: pdf.dataUrl,
      producedBy: [name],
    });
    return fileToolResult({
      title,
      filename: pdf.filename,
      mime: pdf.mime,
      bytes: pdf.buffer.byteLength,
      dataUrl: pdf.dataUrl,
      saved,
      extra: { pages: pdf.pageCount },
    });
  }

  if (name === TOOL_NAMES.generateImage) {
    const generate = ctx.deps?.generateImage ?? generateImageForUser;
    return generate({
      prompt: str(args.prompt),
      size:
        args.size === "square" || args.size === "portrait" || args.size === "landscape"
          ? args.size
          : undefined,
    });
  }

  if (name === TOOL_NAMES.githubListIssues) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    return wrapConnectorResult(
      await githubListIssuesForUser(
        ctx.userId,
        str(args.repo),
        args.state === "open" || args.state === "closed" || args.state === "all"
          ? args.state
          : "open",
        ctx.githubAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.githubGetIssue) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    return wrapConnectorResult(
      await githubGetIssueForUser(
        ctx.userId,
        str(args.repo),
        typeof args.issueNumber === "number" ? args.issueNumber : 0,
        ctx.githubAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.githubListPullRequests) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    return wrapConnectorResult(
      await githubListPullRequestsForUser(
        ctx.userId,
        str(args.repo),
        args.state === "open" || args.state === "closed" || args.state === "all"
          ? args.state
          : "open",
        ctx.githubAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.githubGetPullRequest) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    return wrapConnectorResult(
      await githubGetPullRequestForUser(
        ctx.userId,
        str(args.repo),
        typeof args.pullNumber === "number" ? args.pullNumber : 0,
        ctx.githubAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.githubListCommits) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    return wrapConnectorResult(
      await githubListCommitsForUser(
        ctx.userId,
        str(args.repo),
        str(args.ref) || undefined,
        ctx.githubAccessToken,
      ),
    );
  }

  // Server-side ownership gate for GitHub writes. Never trusts model args:
  // the repository's real owner is compared against the connected account,
  // and org/foreign repos always require a confirmation card.
  const githubWriteOps: Record<string, (owned: boolean) => boolean> = {
    [TOOL_NAMES.githubCreateBranch]: (owned) => owned,
    [TOOL_NAMES.githubCreateOrUpdateFile]: (owned) => owned,
  };
  if (githubWriteOps[name] !== undefined || name === TOOL_NAMES.githubCreateIssue ||
      name === TOOL_NAMES.githubAddIssueComment ||
      name === TOOL_NAMES.githubCreatePullRequest ||
      name === TOOL_NAMES.githubMergePullRequest) {
    if (!ctx.userId || !ctx.hasGitHub) {
      return { ok: false, error: "GitHub is not connected." };
    }
    const repo = str(args.repo);
    if (githubWriteOps[name] !== undefined) {
      const classification = await classifyRepoOwnership(
        ctx.userId,
        repo,
        ctx.githubAccessToken,
      );
      if (!classification.ok) {
        return { ok: false, error: classification.error };
      }
      const owned = githubWriteOps[name]!(
        classification.classification.isOwnedByConnectedUser &&
          classification.classification.hasPush,
      );
      if (!owned) {
        const create =
          ctx.deps?.createConfirmation ??
          ((request: ConfirmationRequest, userId?: string | null) =>
            createConfirmationRequest(request, userId, {
              conversationId: ctx.conversationId,
              runId: ctx.runId,
            }));
        const conf = await create(
          {
            action: "other_side_effect",
            title: `Write to ${repo}`,
            preview: `Aether will write to the GitHub repository ${repo}, which is not owned by your connected account. This is visible to others.`,
            target: repo,
            payload: { tool: name, args, projectId: ctx.projectId ?? null },
          },
          ctx.userId,
        );
        return { ...conf };
      }
      return await executeGithubWrite(name, args, ctx);
    }
    // Publishing actions (issues, comments, PRs, merges) always confirm.
    if (ctx.skipGate) {
      return await executeGithubPublish(name, args, ctx);
    }
    const create =
      ctx.deps?.createConfirmation ??
      ((request: ConfirmationRequest, userId?: string | null) =>
        createConfirmationRequest(request, userId, {
          conversationId: ctx.conversationId,
          runId: ctx.runId,
        }));
    const verb =
      name === TOOL_NAMES.githubCreateIssue
        ? "Open issue"
        : name === TOOL_NAMES.githubAddIssueComment
          ? "Post comment"
          : name === TOOL_NAMES.githubCreatePullRequest
            ? "Open pull request"
            : "Merge pull request";
    const conf = await create(
      {
        action: "other_side_effect",
        title: `${verb} on ${repo}`,
        preview: `${verb} on ${repo}. This is visible to others and may notify watchers.`,
        target: repo,
        payload: { tool: name, args, projectId: ctx.projectId ?? null },
      },
      ctx.userId,
    );
    return { ...conf };
  }

  // Gmail / Calendar / Contacts execution.
  if (name === TOOL_NAMES.gmailSearch) {
    if (!ctx.userId || !ctx.hasGmail) {
      return { ok: false, error: "Gmail is not connected." };
    }
    return wrapConnectorResult(
      await gmailSearchForUser(
        ctx.userId,
        str(args.query),
        typeof args.maxResults === "number" ? args.maxResults : 15,
        ctx.driveAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.gmailRead) {
    if (!ctx.userId || !ctx.hasGmail) {
      return { ok: false, error: "Gmail is not connected." };
    }
    return wrapConnectorResult(
      await gmailReadForUser(ctx.userId, str(args.messageId), ctx.driveAccessToken),
    );
  }

  if (name === TOOL_NAMES.gmailSend) {
    if (!ctx.userId || !ctx.hasGmail) {
      return { ok: false, error: "Gmail is not connected." };
    }
    if (!ctx.skipGate) {
      // Ask mode: email send waits on a card. Auto mode (or an approved
      // replay) sends directly — the user picked that tradeoff.
      const create =
        ctx.deps?.createConfirmation ??
        ((request: ConfirmationRequest, userId?: string | null) =>
          createConfirmationRequest(request, userId, {
            conversationId: ctx.conversationId,
            runId: ctx.runId,
          }));
      const conf = await create(
        {
          action: "send_message",
          title: "Send email",
          preview: `Send an email to ${str(args.to)}: “${str(args.subject)}”.`,
          target: str(args.to),
          payload: { tool: name, args, projectId: ctx.projectId ?? null },
        },
        ctx.userId,
      );
      return { ...conf };
    }
    return wrapConnectorResult(
      await gmailSendForUser(
        ctx.userId,
        {
          to: str(args.to),
          subject: str(args.subject),
          body: str(args.body),
          threadId: str(args.threadId) || undefined,
        },
        ctx.driveAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.gmailCreateDraft) {
    if (!ctx.userId || !ctx.hasGmail) {
      return { ok: false, error: "Gmail is not connected." };
    }
    return wrapConnectorResult(
      await gmailCreateDraftForUser(
        ctx.userId,
        {
          to: str(args.to),
          subject: str(args.subject),
          body: str(args.body),
          threadId: str(args.threadId) || undefined,
        },
        ctx.driveAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.calendarListEvents) {
    if (!ctx.userId || !ctx.hasCalendar) {
      return { ok: false, error: "Google Calendar is not connected." };
    }
    return wrapConnectorResult(
      await calendarListEventsForUser(
        ctx.userId,
        {
          timeMin: str(args.timeMin) || undefined,
          timeMax: str(args.timeMax) || undefined,
          maxResults:
            typeof args.maxResults === "number" ? args.maxResults : undefined,
        },
        ctx.driveAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.calendarCreateEvent) {
    if (!ctx.userId || !ctx.hasCalendar) {
      return { ok: false, error: "Google Calendar is not connected." };
    }
    return wrapConnectorResult(
      await calendarCreateEventForUser(
        ctx.userId,
        {
          summary: str(args.summary),
          start: str(args.start),
          end: str(args.end),
          description: str(args.description) || undefined,
          location: str(args.location) || undefined,
          attendees: Array.isArray(args.attendees)
            ? args.attendees.filter((a): a is string => typeof a === "string")
            : undefined,
          timeZone: str(args.timeZone) || undefined,
        },
        ctx.driveAccessToken,
      ),
    );
  }

  if (name === TOOL_NAMES.calendarDeleteEvent) {
    if (!ctx.userId || !ctx.hasCalendar) {
      return { ok: false, error: "Google Calendar is not connected." };
    }
    if (!ctx.skipGate) {
      const create =
        ctx.deps?.createConfirmation ??
        ((request: ConfirmationRequest, userId?: string | null) =>
          createConfirmationRequest(request, userId, {
            conversationId: ctx.conversationId,
            runId: ctx.runId,
          }));
      const conf = await create(
        {
          action: "delete_resource",
          title: "Delete calendar event",
          preview: "This removes the event from your calendar.",
          target: str(args.eventId),
          payload: { tool: name, args, projectId: ctx.projectId ?? null },
        },
        ctx.userId,
      );
      return { ...conf };
    }
    return wrapConnectorResult(
      await calendarDeleteEventForUser(ctx.userId, str(args.eventId), ctx.driveAccessToken),
    );
  }

  if (name === TOOL_NAMES.contactsSearch) {
    if (!ctx.userId || !ctx.hasContacts) {
      return { ok: false, error: "Google Contacts is not connected." };
    }
    return wrapConnectorResult(
      await contactsSearchForUser(ctx.userId, str(args.query), ctx.driveAccessToken),
    );
  }

  if (name === TOOL_NAMES.contactsCreate) {
    if (!ctx.userId || !ctx.hasContacts) {
      return { ok: false, error: "Google Contacts is not connected." };
    }
    return wrapConnectorResult(
      await contactsCreateForUser(
        ctx.userId,
        {
          firstName: str(args.firstName) || undefined,
          lastName: str(args.lastName) || undefined,
          emails: Array.isArray(args.emails)
            ? args.emails.filter((e): e is string => typeof e === "string")
            : undefined,
          phones: Array.isArray(args.phones)
            ? args.phones.filter((p): p is string => typeof p === "string")
            : undefined,
        },
        ctx.driveAccessToken,
      ),
    );
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
