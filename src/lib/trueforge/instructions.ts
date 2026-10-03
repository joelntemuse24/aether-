import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";

/** Short tool note. The full Aether catalog describes tools this harness does not run. */
export const TRUEFORGE_TOOL_NOTE = `You are Aether. Tools execute on Aether's servers.
Use web_search for live facts (weather, news, prices), then fetch_url or browse_page on the best links. Use the sandbox for computation and files, not for fetching the web.
memory_search, project_knowledge_search, drive_search, drive_read, and github_* read the signed-in user's data when those accounts are connected.
memory_write and create_artifact wait on the user's approval card before they save.
Cite web sources as [1], [2]. End every turn with a clear answer. Do not invent tools you were not given.`;

export const TRUEFORGE_NO_TOOLS_NOTE = `You are Aether. Tools are not connected for this turn.
Answer from the conversation. If the user needs a live lookup, say you cannot reach it right now.
Do not invent tool results.`;

export const TOOLS_UNAVAILABLE_NOTICE = "Tools are not connected for this turn.";

/** Drop the tool catalog when MCP registration did not run. */
export function instructionsForRegisteredTools(instructions: string, toolsAvailable: boolean): string {
  if (toolsAvailable || !instructions.includes(TRUEFORGE_TOOL_NOTE)) return instructions;
  return instructions.replace(TRUEFORGE_TOOL_NOTE, TRUEFORGE_NO_TOOLS_NOTE);
}

function formatClock(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(now);
}

/** Full clock in the prompt. The builtin clock tool is removed by the sidecar patch. */
export function trueforgeClockLine(now = new Date()): string {
  const utc = formatClock(now, "UTC");
  const dublin = formatClock(now, "Europe/Dublin");
  return `Current time (UTC): ${utc}. Europe/Dublin: ${dublin}. Use this time. Call a clock tool only if you need a time more precise than the second.`;
}

export function trueforgeInstructions(
  system: string,
  now = new Date(),
  options?: { toolsAvailable?: boolean },
): string {
  const clock = trueforgeClockLine(now);
  const note = options?.toolsAvailable === false ? TRUEFORGE_NO_TOOLS_NOTE : TRUEFORGE_TOOL_NOTE;
  if (system.startsWith(TOOLS_SYSTEM_PROMPT)) {
    const rest = system.slice(TOOLS_SYSTEM_PROMPT.length).replace(/^\n+/, "");
    return rest ? `${clock}\n${note}\n\n${rest}` : `${clock}\n${note}`;
  }
  return `${clock}\n${system}`;
}
