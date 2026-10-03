/**
 * sandbox_exec and sandbox_files. Commands run inside bubblewrap.
 * File tools only touch that conversation's workspace directory.
 */

import { z } from "zod";
import type { AgentToolDefinition } from "./registry";
import { toolError, toolOk, type ToolResult } from "./results";
import {
  SANDBOX_LIMITS,
  SANDBOX_UNAVAILABLE,
  SandboxPathError,
  type AgentSandbox,
} from "./sandbox";

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

export async function executeSandboxTool(
  name: string,
  input: unknown,
  sandbox: AgentSandbox | null,
  abortSignal?: AbortSignal,
): Promise<ToolResult> {
  if (!sandbox) return toolError(SANDBOX_UNAVAILABLE, false);
  const args = record(input);
  try {
    if (name === "sandbox_exec") {
      const command = text(args.command);
      const result = await sandbox.exec({
        command,
        timeoutMs: SANDBOX_LIMITS.timeoutMs,
        abortSignal,
      });
      if (result.error === SANDBOX_UNAVAILABLE) return toolError(SANDBOX_UNAVAILABLE, false);
      if (result.error) return toolError(result.error, false);
      return toolOk({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut === true,
        aborted: result.aborted === true,
      });
    }
    if (name === "sandbox_files") {
      const op = text(args.op);
      const relative = text(args.path);
      if (op === "list") return toolOk({ files: await sandbox.list(relative) });
      if (op === "read") {
        if (!relative.trim()) return toolError("path is required.", false);
        return toolOk({ path: relative, content: await sandbox.readFile(relative) });
      }
      if (op === "write") {
        if (!relative.trim()) return toolError("path is required.", false);
        const content = text(args.content);
        if (content.length > SANDBOX_LIMITS.maxWriteChars) return toolError("content is too long.", false);
        await sandbox.writeFile(relative, content);
        return toolOk({ path: relative, bytes: Buffer.byteLength(content) });
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
