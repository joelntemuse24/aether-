import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";

/** Short tool note. The full Aether catalog describes tools this harness does not run. */
export const TRUEFORGE_TOOL_NOTE = `You are Aether. Tools execute on Aether's servers.
Use web_search for live facts (weather, news, prices), then fetch_url or browse_page on the best links.
memory_search, project_knowledge_search, drive_search, drive_read, and github_* read the signed-in user's data when those accounts are connected.
memory_write and create_artifact wait on the user's approval card before they save.
Cite web sources as [1], [2]. End every turn with a clear answer. Do not invent tools you were not given.`;

/** UTC clock, stable for the hour so session reuse does not rewrite the prompt every turn. */
export function trueforgeClockLine(now = new Date()): string {
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(hour);
  return `Current time: ${formatted} (UTC). Use this for ordinary date and time questions. Do not call a clock tool unless the user names a different timezone.`;
}

export function trueforgeInstructions(system: string, now = new Date()): string {
  const clock = trueforgeClockLine(now);
  if (system.startsWith(TOOLS_SYSTEM_PROMPT)) {
    const rest = system.slice(TOOLS_SYSTEM_PROMPT.length).replace(/^\n+/, "");
    return rest ? `${clock}\n${TRUEFORGE_TOOL_NOTE}\n\n${rest}` : `${clock}\n${TRUEFORGE_TOOL_NOTE}`;
  }
  return `${clock}\n${system}`;
}
