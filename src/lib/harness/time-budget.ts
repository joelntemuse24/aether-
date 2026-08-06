/**
 * Time-pressure budgets — "I have 5 minutes" forces shallow research + early draft.
 */

import type { HarnessDepth } from "./types";

export type TimeBudget = {
  /** Soft wall-clock guidance for the model (minutes). */
  minutes: number;
  /** Suggested max web_search calls under pressure. */
  maxSearches: number;
  /** Prefer draft/artifact early. */
  forceEarlyDraft: boolean;
  label: string;
};

/** Parse phrases like "in 5 minutes", "I have 10 min", "urgent 2 mins". */
export function parseTimeBudgetFromText(text: string): TimeBudget | null {
  const t = text.trim();
  if (!t) return null;

  const patterns: RegExp[] = [
    /\b(?:in|within|have|got)\s+(\d{1,3})\s*(?:minutes?|mins?|m)\b/i,
    /\b(\d{1,3})\s*(?:minutes?|mins?)\s+(?:left|to\s+spare|to\s+submit|until)\b/i,
    /\burgent(?:ly)?\b.*?\b(\d{1,3})\s*(?:minutes?|mins?)\b/i,
    /\b(\d{1,3})\s*min(?:ute)?\s+deadline\b/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const minutes = Math.min(120, Math.max(1, parseInt(m[1], 10)));
    return timeBudgetForMinutes(minutes);
  }

  if (/\b(asap|right now|urgent|immediately|due now|last minute)\b/i.test(t)) {
    return timeBudgetForMinutes(5);
  }

  return null;
}

export function timeBudgetForMinutes(minutes: number): TimeBudget {
  if (minutes <= 5) {
    return {
      minutes,
      maxSearches: 1,
      forceEarlyDraft: true,
      label: "Urgent (≤5 min)",
    };
  }
  if (minutes <= 15) {
    return {
      minutes,
      maxSearches: 2,
      forceEarlyDraft: true,
      label: "Tight (≤15 min)",
    };
  }
  return {
    minutes,
    maxSearches: 3,
    forceEarlyDraft: false,
    label: `Timed (~${minutes} min)`,
  };
}

/** Cap depth under extreme time pressure. */
export function depthUnderTimePressure(
  depth: HarnessDepth,
  budget: TimeBudget | null | undefined,
): HarnessDepth {
  if (!budget) return depth;
  if (budget.minutes <= 5 && depth === "deep") return "standard";
  return depth;
}

export function timeBudgetSystemAddendum(budget: TimeBudget): string {
  const lines = [
    "## Time budget",
    `The user has about ${budget.minutes} minute(s) (${budget.label}).`,
    `Hard cap: at most ${budget.maxSearches} web_search call(s). Prefer fetch_url on known links.`,
  ];
  if (budget.forceEarlyDraft) {
    lines.push(
      "Draft early: produce a usable artifact or answer before perfect research.",
      "Skip rabbit holes. One pass of research → draft → light verify → hand back.",
      "If they need to submit somewhere, prepare the document first; gate any portal/submit action on confirmation.",
    );
  } else {
    lines.push("Stay efficient; still finish with a clear deliverable.");
  }
  return lines.join("\n");
}
