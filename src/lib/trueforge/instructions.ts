import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";

/** Short tool note. The full Aether catalog describes tools this harness does not run. */
export const TRUEFORGE_TOOL_NOTE = `You are Aether. Tools execute on Aether's servers.
Use web_search for live facts (weather, news, prices), then fetch_url or browse_page on the best links. Use current_time for the clock.
memory_search, project_knowledge_search, drive_search, drive_read, and github_* read the signed-in user's data when those accounts are connected.
memory_write and create_artifact wait on the user's approval card before they save.
Cite web sources as [1], [2]. End every turn with a clear answer. Do not invent tools you were not given.`;

export function trueforgeInstructions(system: string): string {
  if (system.startsWith(TOOLS_SYSTEM_PROMPT)) {
    const rest = system.slice(TOOLS_SYSTEM_PROMPT.length).replace(/^\n+/, "");
    return rest ? `${TRUEFORGE_TOOL_NOTE}\n\n${rest}` : TRUEFORGE_TOOL_NOTE;
  }
  return system;
}
