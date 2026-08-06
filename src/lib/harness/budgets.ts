import type { HarnessDepth, HarnessIntent } from "./types";

export type DepthBudget = {
  depth: HarnessDepth;
  maxSteps: number;
  label: string;
};

const BUDGETS: Record<HarnessDepth, DepthBudget> = {
  shallow: { depth: "shallow", maxSteps: 2, label: "Quick" },
  standard: { depth: "standard", maxSteps: 8, label: "Standard" },
  deep: { depth: "deep", maxSteps: 16, label: "Deep" },
};

export function budgetForDepth(depth: HarnessDepth | undefined): DepthBudget {
  if (depth && depth in BUDGETS) return BUDGETS[depth];
  return BUDGETS.standard;
}

/** Under extreme time pressure, slightly reduce max tool steps so we draft sooner. */
export function budgetForDepthWithTime(
  depth: HarnessDepth | undefined,
  timeMinutes?: number | null,
): DepthBudget {
  const base = budgetForDepth(depth);
  if (timeMinutes == null) return base;
  if (timeMinutes <= 5) {
    return {
      ...base,
      maxSteps: Math.min(base.maxSteps, depth === "shallow" ? 2 : 6),
      label: `${base.label} · timed`,
    };
  }
  if (timeMinutes <= 15) {
    return {
      ...base,
      maxSteps: Math.min(base.maxSteps, base.maxSteps <= 2 ? 2 : base.maxSteps - 2),
      label: `${base.label} · timed`,
    };
  }
  return base;
}

/**
 * Extra system contract injected for the chosen depth/intent.
 * Deep paths require a verify pass — "extra mile" as policy, not hope.
 */
export function harnessSystemAddendum(input: {
  depth: HarnessDepth;
  intent: HarnessIntent;
  clarifications?: Record<string, string>;
  planSteps?: string[];
}): string {
  const lines: string[] = [
    "## Harness mode",
    `Intent: ${input.intent}. Depth: ${input.depth}.`,
  ];

  if (input.planSteps?.length) {
    lines.push("Suggested plan (adapt if needed):");
    for (const [i, step] of input.planSteps.entries()) {
      lines.push(`${i + 1}. ${step}`);
    }
  }

  if (input.clarifications && Object.keys(input.clarifications).length > 0) {
    lines.push("User clarifications for this turn:");
    for (const [k, v] of Object.entries(input.clarifications)) {
      lines.push(`- ${k}: ${v}`);
    }
  }

  if (input.depth === "shallow") {
    lines.push(
      "Keep the answer short and direct. Prefer no tools unless accuracy clearly requires one.",
    );
  } else if (input.depth === "standard") {
    lines.push(
      "Use tools when they improve accuracy. Prefer a clear structure. One follow-up question at the end is fine if useful.",
    );
  } else {
    lines.push(
      "Deep mode — go beyond a surface answer:",
      "1. Gather: use tools or close-read provided text before concluding.",
      "2. Draft: produce a substantive answer (or artifact for long work).",
      "3. Verify: explicitly check gaps, uncertainties, and counterpoints; revise if needed before the final reply.",
      "4. Hand back: state what would strengthen the answer further.",
      "Do not stop at a generic overview when specifics are available.",
    );
    if (input.intent === "study") {
      lines.push(
        "Study depth: quote or paraphrase the source, name ambiguities, and offer one implication or application.",
      );
    }
    if (input.intent === "research") {
      lines.push(
        "Research depth: prefer cited snippets from tools; separate facts from inference.",
      );
    }
    if (input.intent === "write") {
      lines.push(
        "Writing depth: prefer a living artifact for substantial drafts; strengthen the user's voice.",
      );
    }
    if (input.intent === "life_admin") {
      lines.push(
        "Life-admin: propose a concrete next action; do not claim to have purchased, submitted, or emailed unless a tool actually did.",
      );
    }
  }

  return lines.join("\n");
}
