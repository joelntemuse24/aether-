import { TOOLS_SYSTEM_PROMPT } from "@/lib/tools";

/** How a downloadable sandbox file reaches the thread. Paths stay off the answer. */
export const SANDBOX_FILE_LINE =
  "For a downloadable deck, spreadsheet, document, PDF, or image, write the file in the sandbox (pptx, xlsx, docx, pdf, or png). List each file once in a sandbox_artifacts block as [label](path). Do not paste /home paths or sandbox paths in the answer. A file card is added for each file.";

/** Short tool note. The full Aether catalog describes tools this harness does not run. */
export const TRUEFORGE_TOOL_NOTE = `You are Aether. Tools execute on Aether's servers.
Use web_search for live facts (weather, news, prices), then fetch_url or browse_page on the best links. Use the sandbox for computation and files, not for fetching the web.
memory_search, project_knowledge_search, drive_search, drive_read, and github_* read the signed-in user's data when those accounts are connected.
memory_write and create_artifact wait on the user's approval card before they save.
Cite web sources as [1], [2]. End every turn with a clear answer. Do not invent tools you were not given.
If a detail is missing, make a reasonable assumption and state it. Do not stop to ask the user to choose.
For a chart or interactive view, write a fenced svg, html, or react block, or a png image. The thread shows an artifact card that opens Preview and Code. Do not emit an openui block.
${SANDBOX_FILE_LINE}`;

export const TRUEFORGE_NO_TOOLS_NOTE = `You are Aether. Tools are not connected for this turn.
Answer from the conversation. If the user needs a live lookup, say you cannot reach it right now.
Do not invent tool results.
If a detail is missing, make a reasonable assumption and state it. Do not stop to ask the user to choose.
For a chart or interactive view, write a fenced svg, html, or react block, or a png image. The thread shows an artifact card that opens Preview and Code. Do not emit an openui block.
${SANDBOX_FILE_LINE}`;

export const TOOLS_UNAVAILABLE_NOTICE = "Tools are not connected for this turn.";

/** Drop the tool catalog when MCP registration did not run. */
export function instructionsForRegisteredTools(instructions: string, toolsAvailable: boolean): string {
  if (toolsAvailable || !instructions.includes(TRUEFORGE_TOOL_NOTE)) return instructions;
  return instructions.replace(TRUEFORGE_TOOL_NOTE, TRUEFORGE_NO_TOOLS_NOTE);
}

/** Name only the tools this turn actually attached. */
export function trueforgeToolNote(attached: readonly string[]): string {
  const webIds = new Set(["web_search", "fetch_url", "browse_page"]);
  const web = attached.filter((name) => webIds.has(name));
  const rest = attached.filter((name) => !webIds.has(name));
  const lines = ["You are Aether. Tools execute on Aether's servers."];
  if (web.length) {
    lines.push(
      `Use ${web.join(", ")} for the web. Use the sandbox for computation and files, not for fetching the web.`,
    );
  }
  if (rest.length) {
    lines.push(`These tools are available when the account is connected: ${rest.join(", ")}.`);
  }
  lines.push("Cite web sources as [1], [2]. End every turn with a clear answer. Do not invent tools you were not given.");
  lines.push(
    "If a detail is missing, make a reasonable assumption and state it. Do not stop to ask the user to choose.",
  );
  lines.push(
    "For a chart or interactive view, write a fenced svg, html, or react block, or a png image. The thread shows an artifact card that opens Preview and Code. Do not emit an openui block.",
  );
  if (attached.includes("create_artifact")) {
    lines.push(
      "Save that chart or interactive view with create_artifact using kind svg, html, react, or image.",
    );
  }
  lines.push(SANDBOX_FILE_LINE);
  return lines.join("\n");
}

const OFFICE_TOOL_REPLACEMENTS: Record<string, string> = {
  create_presentation: "a pptx written in the sandbox",
  create_spreadsheet: "an xlsx written in the sandbox",
  create_document: "a docx written in the sandbox",
  create_pdf: "a pdf written in the sandbox",
  workspace_publish_file: "the sandbox",
  workspace_exec: "the sandbox",
  workspace_read_file: "the sandbox",
  workspace_write_file: "the sandbox",
  workspace_list_files: "the sandbox",
  workspace_ffmpeg: "the sandbox",
  execute_python: "the sandbox",
  verify_checklist: "a final check",
  create_artifact: "a fenced block",
};

/** Playbooks name office tools this harness does not attach. Point those at the sandbox instead. */
export function alignHostedFileInstructions(text: string, attached: readonly string[]): string {
  const keep = new Set(attached);
  const banned = Object.keys(OFFICE_TOOL_REPLACEMENTS)
    .filter((name) => !keep.has(name))
    .sort((a, b) => b.length - a.length);
  let next = text;
  let touched = false;
  for (const name of banned) {
    if (!next.includes(name)) continue;
    touched = true;
    next = next.replaceAll(name, OFFICE_TOOL_REPLACEMENTS[name] ?? "");
  }
  if (next.includes("github_*") && !attached.some((name) => name.startsWith("github_"))) {
    next = next.replaceAll("github_*", "connected accounts");
    touched = true;
  }
  next = next.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  if (touched && !next.includes("sandbox_artifacts block")) {
    next = `${next.trim()}\n${SANDBOX_FILE_LINE}`;
  }
  return next;
}

export function instructionsForAttachedTools(instructions: string, attached: readonly string[]): string {
  const note = attached.length ? trueforgeToolNote(attached) : TRUEFORGE_NO_TOOLS_NOTE;
  const swapped = instructions.includes(TRUEFORGE_TOOL_NOTE)
    ? instructions.replace(TRUEFORGE_TOOL_NOTE, note)
    : instructions;
  return alignHostedFileInstructions(swapped, attached);
}

/** Tool ids that appear in a prompt. `github_*` means every catalog id with that prefix. */
export function toolNamesInPrompt(text: string, catalog: readonly string[]): string[] {
  const found = new Set<string>();
  const wildcard = text.includes("github_*");
  const ordered = [...catalog].sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    if (wildcard && name.startsWith("github_")) found.add(name);
    if (text.includes(name)) found.add(name);
  }
  return [...found].sort();
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
