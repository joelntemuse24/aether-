/**
 * First-turn Head Start tools: schema-only mutations, but execute cheap
 * read-only tools on this warm Next process so web_search does not wait
 * for the durable agent to boot.
 *
 * The rest of the loop (python, artifacts, connectors, later steps) stays
 * on the worker. Do not import tool-registry here.
 */

import { tool, type ToolSet } from "ai";
import { TOOL_NAMES } from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
import { resolveCurrentTime } from "@/lib/current-time";
import { fetchUrlText } from "@/lib/connectors/web-and-drive";
import { browsePage } from "@/lib/connectors/browse-page";
import {
  buildHeadStartToolSchemas,
  type HeadStartToolCapabilities,
} from "@/lib/harness/tool-schemas";

export const HEAD_START_FAST_EXECUTE_TOOLS = [
  TOOL_NAMES.currentTime,
  TOOL_NAMES.webSearch,
  TOOL_NAMES.fetchUrl,
  TOOL_NAMES.browsePage,
] as const;

export function buildHeadStartFastTools(
  caps: HeadStartToolCapabilities,
): ToolSet {
  const schemas = buildHeadStartToolSchemas(caps);
  const time = schemas[TOOL_NAMES.currentTime];
  const web = schemas[TOOL_NAMES.webSearch];
  const fetchTool = schemas[TOOL_NAMES.fetchUrl];
  const browse = schemas[TOOL_NAMES.browsePage];

  return {
    ...schemas,
    ...(time
      ? {
          [TOOL_NAMES.currentTime]: tool({
            ...time,
            execute: async ({ timeZone }) => resolveCurrentTime({ timeZone }),
          }),
        }
      : {}),
    ...(web
      ? {
          [TOOL_NAMES.webSearch]: tool({
            ...web,
            execute: async ({ query }) => runWebSearch(query),
          }),
        }
      : {}),
    ...(fetchTool
      ? {
          [TOOL_NAMES.fetchUrl]: tool({
            ...fetchTool,
            execute: async ({ url }) => fetchUrlText(url),
          }),
        }
      : {}),
    ...(browse
      ? {
          [TOOL_NAMES.browsePage]: tool({
            ...browse,
            execute: async ({ url, instructions }) =>
              browsePage({ url, instructions }),
          }),
        }
      : {}),
  };
}
