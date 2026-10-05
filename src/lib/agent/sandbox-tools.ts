/**
 * sandbox_exec and sandbox_files. Commands run inside bubblewrap.
 * File tools only touch that conversation's workspace directory.
 */

import { z } from "zod";
import { fileToolResult } from "@/lib/artifacts/file-result";
import {
  isSafePublishedFilename,
  redactSandboxText,
  sanitizePublishedFile,
  type SandboxFileCard,
  type SandboxFilePayload,
} from "./publish-files";
import type { AgentToolDefinition } from "./registry";
import { toolError, toolOk, type ToolResult } from "./results";
import {
  SANDBOX_LIMITS,
  SANDBOX_UNAVAILABLE,
  SandboxPathError,
  type AgentSandbox,
} from "./sandbox";
import { postTurnCallback } from "./turn-callback";

export const sandboxExecInput = z.object({
  command: z
    .string()
    .describe(
      "Shell command in the sandbox workspace. Python 3 can import pandas, numpy, matplotlib, openpyxl, and pptx. There is no network. Write charts, spreadsheets, and decks in the working directory.",
    ),
});

export const sandboxFilesInput = z.object({
  op: z.enum(["write", "read", "list"]).describe("write, read, or list files in the sandbox workspace."),
  path: z.string().optional().describe("Path relative to the workspace. Required for write and read."),
  content: z.string().optional().describe("UTF-8 file contents for write."),
});

export const SANDBOX_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  {
    name: "sandbox_exec",
    description:
      "Run a shell command in a sandbox with no network. Python 3 includes pandas, numpy, matplotlib, openpyxl, and python-pptx. The working directory is the conversation workspace. Write charts, spreadsheets, and decks there.",
    inputSchema: sandboxExecInput,
    timeoutMs: SANDBOX_LIMITS.timeoutMs,
    risk: "write",
    runsOn: "vm",
    requiresAuth: false,
  },
  {
    name: "sandbox_files",
    description:
      "Read, write, or list files in the sandbox workspace. Paths stay inside that workspace. Use this for chart, spreadsheet, and deck files the command created.",
    inputSchema: sandboxFilesInput,
    timeoutMs: 10_000,
    risk: "write",
    runsOn: "vm",
    requiresAuth: false,
  },
];

function record(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type SandboxPublishContext = {
  turnToken: string;
  origin: string | null;
  abortSignal?: AbortSignal;
  fetchImpl?: typeof fetch;
  checkOrigin?: (origin: string) => Promise<boolean>;
};

const PUBLISH_FAILED = "Could not publish that file.";

async function publishOne(file: SandboxFilePayload, publish?: SandboxPublishContext): Promise<SandboxFileCard | null> {
  if (!isSafePublishedFilename(file.filename)) return null;
  if (publish?.origin && publish.turnToken.trim()) {
    const posted = await postTurnCallback({
      name: "publish_native_file",
      args: { filename: file.filename, mime: file.mime, dataUrl: file.dataUrl },
      turnToken: publish.turnToken,
      origin: publish.origin,
      abortSignal: publish.abortSignal,
      fetchImpl: publish.fetchImpl,
      checkOrigin: publish.checkOrigin,
      unavailable: PUBLISH_FAILED,
      failed: PUBLISH_FAILED,
    });
    if (posted.ok) {
      const card = sanitizePublishedFile(posted.data);
      if (card) return card;
    }
  }
  const title = file.filename.split("/").pop() || file.filename;
  return sanitizePublishedFile(
    fileToolResult({
      title,
      filename: file.filename,
      mime: file.mime,
      bytes: file.bytes,
      dataUrl: file.dataUrl,
      saved: { persisted: false },
    }),
  );
}

async function publishedCards(
  sandbox: AgentSandbox,
  sinceMs: number,
  publish?: SandboxPublishContext,
  only?: string,
): Promise<SandboxFileCard[]> {
  if (!sandbox.exportFiles) return [];
  const files = await sandbox.exportFiles(sinceMs, only);
  const cards: SandboxFileCard[] = [];
  for (const file of files) {
    if (only && file.filename !== only) continue;
    const card = await publishOne(file, publish);
    if (card) cards.push(card);
  }
  return cards;
}

export async function executeSandboxTool(
  name: string,
  input: unknown,
  sandbox: AgentSandbox | null,
  abortSignal?: AbortSignal,
  publish?: SandboxPublishContext,
): Promise<ToolResult> {
  if (!sandbox) return toolError(SANDBOX_UNAVAILABLE, false);
  const args = record(input);
  try {
    if (name === "sandbox_exec") {
      const command = text(args.command);
      const started = Date.now();
      const result = await sandbox.exec({
        command,
        timeoutMs: SANDBOX_LIMITS.timeoutMs,
        abortSignal,
      });
      if (result.error === SANDBOX_UNAVAILABLE) return toolError(SANDBOX_UNAVAILABLE, false);
      if (result.error) return toolError(result.error, false);
      const files = await publishedCards(sandbox, started, publish);
      return toolOk({
        stdout: redactSandboxText(result.stdout),
        stderr: redactSandboxText(result.stderr),
        exitCode: result.exitCode,
        timedOut: result.timedOut === true,
        aborted: result.aborted === true,
        files,
      });
    }
    if (name === "sandbox_files") {
      const op = text(args.op);
      const relative = text(args.path);
      if (op === "list") return toolOk({ files: await sandbox.list(relative) });
      if (op === "read") {
        if (!relative.trim()) return toolError("path is required.", false);
        if (!isSafePublishedFilename(relative)) {
          return toolOk({ path: relative, content: await sandbox.readFile(relative) });
        }
        const files = await publishedCards(sandbox, 0, publish, relative);
        if (files.length > 0) return toolOk({ path: relative, files });
        return toolOk({ path: relative, content: await sandbox.readFile(relative) });
      }
      if (op === "write") {
        if (!relative.trim()) return toolError("path is required.", false);
        const content = text(args.content);
        if (content.length > SANDBOX_LIMITS.maxWriteChars) return toolError("content is too long.", false);
        await sandbox.writeFile(relative, content);
        const files = isSafePublishedFilename(relative) ? await publishedCards(sandbox, 0, publish, relative) : [];
        return toolOk({ path: relative, bytes: Buffer.byteLength(content), files });
      }
      return toolError("op must be write, read, or list.", false);
    }
  } catch (error) {
    if (error instanceof SandboxPathError) return toolError(error.message, false);
    if (error instanceof Error && error.message === "content is too long.") return toolError(error.message, false);
    return toolError(SANDBOX_UNAVAILABLE, false);
  }
  return toolError("Tool is not available.", false);
}
