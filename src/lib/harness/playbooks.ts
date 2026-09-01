import type { HarnessIntent } from "./types";

export const PLAYBOOK_IDS = ["research", "write-doc", "slides", "sheet"] as const;
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
      "Use web_search (few focused queries) then fetch_url on the best links. Cite titles/URLs. A search does not replace the thread — keep prior facts (names, numbers). End with a usable answer.",
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
      "Deliver a deck via create_artifact (kind \"document\" or \"data\"): numbered slides with a title and 3–5 bullets each. Do not dump a wall of prose in chat.",
  },
  sheet: {
    id: "sheet",
    label: "Sheet",
    promptHint:
      "Deliver a table via create_artifact kind \"data\" (CSV or JSON rows). Clear headers, one fact per cell. Mention the table in chat; put the grid in the artifact.",
  },
};

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

  if (
    intent === "research" ||
    /\b(research|search|look up|sources?|cite|latest|news)\b/.test(lower)
  ) {
    add("research");
  }
  if (
    intent === "write" ||
    /\b(essay|document|memo|briefing|write-doc|write a (doc|document|brief|paper))\b/.test(
      lower,
    )
  ) {
    add("write-doc");
  }
  if (/\b(slides?|deck|presentation|powerpoint|keynote)\b/.test(lower)) {
    add("slides");
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
