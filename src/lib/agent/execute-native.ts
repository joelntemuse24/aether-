/**
 * Dispatch one native tool call. Web tools stay on the VM.
 * Account tools are a signed callback. Sandbox tools are not implemented.
 */

import { executeAccountCallback } from "./account-callback";
import { agentToolGroup } from "./registry";
import { toolError, type ToolResult } from "./results";
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
}): Promise<ToolResult> {
  const group = agentToolGroup(input.name);
  if (group === "web") return executeWebTool(input.name, input.args, input.web);
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
  return toolError("Tool is not available.", false);
}
