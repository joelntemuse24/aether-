/**
 * Explicit verify-phase contract for deep (and time-pressured) runs.
 * Not only prompt hope — structured checklist the model must complete.
 */

import { z } from "zod";
import type { HarnessDepth, HarnessIntent } from "./types";
import type { TimeBudget } from "./time-budget";

export const verifyChecklistInput = z.object({
  summary: z
    .string()
    .describe("One-paragraph summary of what was delivered."),
  checks: z
    .array(
      z.object({
        item: z.string().describe("What was checked."),
        ok: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
  remaining_risks: z
    .array(z.string())
    .max(6)
    .optional()
    .describe("Open gaps or uncertainties."),
  ready_for_user: z
    .boolean()
    .describe("True if the deliverable is good enough to hand back."),
});

export type VerifyChecklistInput = z.infer<typeof verifyChecklistInput>;

export type VerifyChecklistOutput = {
  ok: boolean;
  verified: boolean;
  summary: string;
  failed: string[];
  remaining_risks: string[];
  instruction: string;
};

export function runVerifyChecklist(
  input: VerifyChecklistInput,
): VerifyChecklistOutput {
  const failed = input.checks.filter((c) => !c.ok).map((c) => c.item);
  const verified = input.ready_for_user && failed.length === 0;
  return {
    ok: true,
    verified,
    summary: input.summary,
    failed,
    remaining_risks: input.remaining_risks ?? [],
    instruction: verified
      ? "Verify passed. Hand the deliverable to the user clearly."
      : failed.length > 0
        ? `Verify incomplete — address failed checks: ${failed.join("; ")}. Then call verify_checklist again or explain limits to the user.`
        : "Mark remaining risks clearly for the user before finishing.",
  };
}

export function verifySystemAddendum(input: {
  depth: HarnessDepth;
  intent: HarnessIntent;
  timeBudget?: TimeBudget | null;
}): string | null {
  const needs =
    input.depth === "deep" ||
    input.intent === "research" ||
    input.intent === "write" ||
    input.intent === "study" ||
    !!input.timeBudget?.forceEarlyDraft;

  if (!needs) return null;

  const lines = [
    "## Verify phase (required)",
    "Before your final user-facing answer on substantial work:",
    "1. Call verify_checklist with concrete checks (facts cited, prompt covered, tone/format, risks).",
    "2. If checks fail, fix or be explicit about limits — do not silently ship a weak draft.",
    "3. For essays/docs, the deliverable should live in create_artifact when long.",
  ];

  if (input.timeBudget?.forceEarlyDraft) {
    lines.push(
      "Under time pressure: verify lightly (3–5 checks) after the draft exists — do not block drafting on perfect research.",
    );
  }

  return lines.join("\n");
}
