/**
 * Web tools on the VM. Page fetches stay on the public-URL check.
 * This module does not import Next or connector cookies.
 */

import { browsePage, fetchUrlText } from "@/lib/connectors/browse-page";
import { resolveCurrentTime } from "@/lib/current-time";
import { toolError, toolOk, type ToolResult } from "./results";
import { postTurnCallback } from "./turn-callback";

export const SEARCH_UNAVAILABLE = "Search is unavailable this turn.";
export const SEARCH_FAILED = "Search failed.";

export type WebExecDeps = {
  search?: (query: string) => Promise<unknown>;
  fetchUrl?: typeof fetchUrlText;
  browse?: typeof browsePage;
  now?: Date;
  callback?: {
    turnToken: string;
    origin: string | null;
    abortSignal?: AbortSignal;
    fetchImpl?: typeof fetch;
    checkOrigin?: (origin: string) => Promise<boolean>;
  };
};

function record(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function searchPayload(payload: unknown): ToolResult {
  if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === false) {
    const error = (payload as { error?: unknown }).error;
    const message = typeof error === "string" && error.trim() ? error.trim().slice(0, 400) : SEARCH_FAILED;
    return toolError(message, true);
  }
  return toolOk(payload);
}

function safeError(error: unknown, fallback: string): string {
  if (typeof error !== "string") return fallback;
  const message = error.trim();
  if (!message || message.length > 240) return fallback;
  if (/key|token|secret|bearer|sk-/i.test(message)) return fallback;
  return message;
}

export async function executeWebTool(
  name: string,
  input: unknown,
  deps: WebExecDeps = {},
): Promise<ToolResult> {
  const args = record(input);
  if (name === "web_search") {
    const query = text(args.query).trim();
    if (!query) return toolError("query is required.", false);
    try {
      const payload = deps.search
        ? await deps.search(query)
        : deps.callback
          ? await postTurnCallback({
              name: "web_search",
              args: { query },
              turnToken: deps.callback.turnToken,
              origin: deps.callback.origin,
              abortSignal: deps.callback.abortSignal,
              fetchImpl: deps.callback.fetchImpl,
              checkOrigin: deps.callback.checkOrigin,
              unavailable: SEARCH_UNAVAILABLE,
              failed: SEARCH_FAILED,
            })
          : null;
      if (!payload) return toolError(SEARCH_UNAVAILABLE, false);
      if (deps.search) return searchPayload(payload);
      return payload as ToolResult;
    } catch {
      return toolError(SEARCH_FAILED, true);
    }
  }
  if (name === "fetch_url") {
    try {
      const page = await (deps.fetchUrl ?? fetchUrlText)(text(args.url));
      if (!page.ok) return toolError(safeError(page.error, "Could not read that page."), true);
      return toolOk(page);
    } catch {
      return toolError("Could not read that page.", true);
    }
  }
  if (name === "browse_page") {
    const instructions = text(args.instructions).trim();
    try {
      const page = await (deps.browse ?? browsePage)({
        url: text(args.url),
        instructions: instructions || undefined,
      });
      if (!page.ok) return toolError(safeError(page.error, "Could not read that page."), true);
      return toolOk(page);
    } catch {
      return toolError("Could not read that page.", true);
    }
  }
  if (name === "current_time") {
    const timeZone = text(args.timeZone).trim();
    return toolOk(resolveCurrentTime({ timeZone: timeZone || undefined, now: deps.now }));
  }
  return toolError("Tool is not available.", false);
}
