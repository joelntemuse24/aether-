/**
 * VM → Vercel POST for a native turn-token tool.
 * The bearer is the turn token. It is not copied into the JSON body.
 */

import { assertPublicHttpUrl } from "@/lib/connectors/url-safety";
import { toolError, toolOk, type ToolResult } from "./results";

function safeError(error: unknown, fallback: string): string {
  if (typeof error !== "string") return fallback;
  const message = error.trim();
  if (!message || message.length > 400) return fallback;
  if (/key|token|secret|bearer|sk-/i.test(message)) return fallback;
  return message;
}

export async function postTurnCallback(input: {
  name: string;
  args: unknown;
  turnToken: string;
  origin: string | null;
  abortSignal?: AbortSignal;
  fetchImpl?: typeof fetch;
  checkOrigin?: (origin: string) => Promise<boolean>;
  unavailable: string;
  failed: string;
}): Promise<ToolResult> {
  const origin = (input.origin ?? "").trim().replace(/\/+$/, "");
  const token = input.turnToken.trim();
  if (!origin || !token) return toolError(input.unavailable, false);
  const allowed = input.checkOrigin
    ? await input.checkOrigin(origin)
    : (await assertPublicHttpUrl(origin)).ok;
  if (!allowed) return toolError(input.unavailable, false);

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
    return toolError(input.failed, true);
  }
  if (response.status >= 300 && response.status < 400) {
    return toolError(input.unavailable, false);
  }
  const text = await response.text();
  if (!response.ok) return toolError(input.failed, response.status >= 500);
  try {
    const body = JSON.parse(text) as unknown;
    if (!body || typeof body !== "object") return toolError(input.failed, true);
    const record = body as { ok?: unknown; error?: unknown };
    if (record.ok === false) return toolError(safeError(record.error, input.failed), false);
    return toolOk(body);
  } catch {
    return toolError(input.failed, true);
  }
}
