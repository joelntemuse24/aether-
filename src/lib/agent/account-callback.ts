/**
 * VM → Vercel callback for account tools.
 * The body is the tool name and arguments. The Authorization bearer is the
 * turn token. Drive and GitHub cookies are not on this request.
 */

import { assertPublicHttpUrl } from "@/lib/connectors/url-safety";
import { toolError, toolOk, type ToolResult } from "./results";

export const ACCOUNT_TOOL_UNAVAILABLE = "Account tools are unavailable this turn.";
export const ACCOUNT_TOOL_FAILED = "Account tool failed.";

function safeError(error: unknown, fallback: string): string {
  if (typeof error !== "string") return fallback;
  const message = error.trim();
  if (!message || message.length > 240) return fallback;
  if (/key|token|secret|bearer|sk-/i.test(message)) return fallback;
  return message;
}

export async function executeAccountCallback(input: {
  name: string;
  args: unknown;
  turnToken: string;
  origin: string | null;
  abortSignal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Test hook. Production uses the public-URL check. */
  checkOrigin?: (origin: string) => Promise<boolean>;
}): Promise<ToolResult> {
  const origin = (input.origin ?? "").trim().replace(/\/+$/, "");
  const token = input.turnToken.trim();
  if (!origin || !token) return toolError(ACCOUNT_TOOL_UNAVAILABLE, false);
  const allowed = input.checkOrigin
    ? await input.checkOrigin(origin)
    : (await assertPublicHttpUrl(origin)).ok;
  if (!allowed) return toolError(ACCOUNT_TOOL_UNAVAILABLE, false);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${origin}/api/hermes/aether-tools`, {
      method: "POST",
      redirect: "manual",
      signal: input.abortSignal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        arguments: input.args ?? {},
      }),
    });
  } catch {
    return toolError(ACCOUNT_TOOL_FAILED, true);
  }
  if (response.status >= 300 && response.status < 400) {
    return toolError(ACCOUNT_TOOL_UNAVAILABLE, false);
  }
  const text = await response.text();
  if (!response.ok) return toolError(ACCOUNT_TOOL_FAILED, response.status >= 500);
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object") return toolError(ACCOUNT_TOOL_FAILED, true);
    const record = body as { ok?: unknown; error?: unknown };
    if (record.ok === false) return toolError(safeError(record.error, ACCOUNT_TOOL_FAILED), false);
    return toolOk(body);
  } catch {
    return toolError(ACCOUNT_TOOL_FAILED, true);
  }
}
