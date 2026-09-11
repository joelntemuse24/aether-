import type { HarnessIntent } from "./types";

export const PLAYBOOK_IDS = [
  "research",
  "write-doc",
  "slides",
  "sheet",
  "research-then-deck",
] as const;
export type PlaybookId = (typeof PLAYBOOK_IDS)[number];

export type Playbook = {
  id: PlaybookId;
  label: string;
  promptHint: string;
};

const PLAYBOOKS: Record<PlaybookId, Playbook> = {
  research: {
    id: "research",
    label: "Research",
    promptHint:
      "Use web_search (few focused queries) then fetch_url on the best links. Cite inline as [1], [2] matching result ids. A search does not replace the thread — keep prior facts (names, numbers). End with a usable answer.",
  },
  "write-doc": {
    id: "write-doc",
    label: "Write document",
    promptHint:
      "Draft long prose with create_artifact kind \"document\". Outline if needed, then write. Keep the artifact on this thread. Short chat commentary; body in the artifact.",
  },
  slides: {
    id: "slides",
    label: "Slides",
    promptHint:
      "Deliver a real PowerPoint via create_presentation (structured slides: title + 3–5 bullets). Do not use create_artifact markdown, and do not wait on workspace_exec / python-pptx. Keep the .pptx on this thread.",
  },
  sheet: {
    id: "sheet",
    label: "Sheet",
    promptHint:
      "Deliver a real spreadsheet via create_spreadsheet (.xlsx with headers and rows). Mention the file in chat; put the grid in the workbook. Use create_artifact kind \"data\" only if they asked for CSV/JSON in the panel, not a downloadable workbook.",
  },
  "research-then-deck": {
    id: "research-then-deck",
    label: "Research then deck",
    promptHint:
      "Sequence on this turn (durable worker — do not rush a markdown stand-in): 1) web_search a few focused queries, 2) fetch_url the best sources, 3) synthesize with inline [1] [2] citations matching result ids, 4) create_presentation with sourced figures (no lorem; structured slides, title + 3–5 bullets), 5) verify_checklist including “real .pptx on this thread”. Do not wait on workspace_exec to build the deck. The file chip + Download must appear in-thread.",
  },
};

const SLIDES_RE = /\b(slides?|deck|presentation|powerpoint|keynote|pptx)\b/;
const RESEARCH_RE = /\b(research|search|look up|sources?|cite|latest|news)\b/;

export function resolvePlaybooks(input: {
  text?: string;
  intent?: HarnessIntent | string;
}): Playbook[] {
  const lower = (input.text ?? "").trim().toLowerCase();
  const intent = input.intent ?? "chat";
  const out: Playbook[] = [];
  const add = (id: PlaybookId) => {
    if (!out.some((p) => p.id === id)) out.push(PLAYBOOKS[id]);
  };

  const wantsResearch = intent === "research" || RESEARCH_RE.test(lower);
  const wantsSlides = SLIDES_RE.test(lower);

  if (wantsResearch && wantsSlides) {
    add("research-then-deck");
  } else {
    if (wantsResearch) add("research");
    if (wantsSlides) add("slides");
  }
  if (
    intent === "write" ||
    /\b(essay|document|memo|briefing|write-doc|write a (doc|document|brief|paper))\b/.test(
      lower,
    )
  ) {
    add("write-doc");
  }
  if (
    /\b(spreadsheet|sheet|csv|excel|tabular|table of)\b/.test(lower) ||
    /\bbuild a (sheet|table)\b/.test(lower)
  ) {
    add("sheet");
  }

  return out;
}

export function playbooksSystemAddendum(playbooks: Playbook[]): string {
  if (playbooks.length === 0) return "";
  return [
    "## Playbooks (this turn)",
    ...playbooks.map((p) => `- ${p.id} (${p.label}): ${p.promptHint}`),
  ].join("\n");
}
