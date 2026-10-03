/**
 * Web tools on the VM. Page fetches stay on the public-URL check.
 * This module does not import Next or connector cookies.
 */

import { browsePage, fetchUrlText } from "@/lib/connectors/browse-page";
import { resolveCurrentTime } from "@/lib/current-time";
import { runWebSearch } from "@/lib/web-search";
import { toolError, toolOk, type ToolResult } from "./results";

export type WebExecDeps = {
  search?: (query: string) => Promise<unknown>;
  fetchUrl?: typeof fetchUrlText;
  browse?: typeof browsePage;
  now?: Date;
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
      return toolOk(await (deps.search ?? runWebSearch)(query));
    } catch {
      return toolError("Search failed.", true);
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
