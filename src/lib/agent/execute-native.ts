/**
 * Dispatch one native tool call. Page tools stay on the VM.
 * web_search, account tools, and published sandbox files call back to Vercel.
 */

import { executeAccountCallback } from "./account-callback";
import { agentToolGroup } from "./registry";
import { toolError, type ToolResult } from "./results";
import type { AgentSandbox } from "./sandbox";
import { executeSandboxTool } from "./sandbox-tools";
import { executeWebTool, type WebExecDeps } from "./web-exec";

export async function executeNativeTool(input: {
  name: string;
  args: unknown;
  abortSignal?: AbortSignal;
  turnToken: string;
  callbackOrigin: string | null;
  fetchImpl?: typeof fetch;
  checkOrigin?: (origin: string) => Promise<boolean>;
  web?: WebExecDeps;
  sandbox?: AgentSandbox | null;
}): Promise<ToolResult> {
  const group = agentToolGroup(input.name);
  if (group === "web") {
    return executeWebTool(input.name, input.args, {
      ...input.web,
      callback: {
        turnToken: input.turnToken,
        origin: input.callbackOrigin,
        abortSignal: input.abortSignal,
        fetchImpl: input.fetchImpl,
        checkOrigin: input.checkOrigin,
      },
    });
  }
  if (group === "account") {
    return executeAccountCallback({
      name: input.name,
      args: input.args,
      turnToken: input.turnToken,
      origin: input.callbackOrigin,
      abortSignal: input.abortSignal,
      fetchImpl: input.fetchImpl,
      checkOrigin: input.checkOrigin,
    });
  }
  if (group === "sandbox") {
    return executeSandboxTool(input.name, input.args, input.sandbox ?? null, input.abortSignal, {
      turnToken: input.turnToken,
      origin: input.callbackOrigin,
      abortSignal: input.abortSignal,
      fetchImpl: input.fetchImpl,
      checkOrigin: input.checkOrigin,
    });
  }
  return toolError("Tool is not available.", false);
}
