import { z } from "zod";

export const HARNESS_INTENTS = [
  "chat",
  "research",
  "write",
  "life_admin",
  "study",
  "code",
  "other",
] as const;

export type HarnessIntent = (typeof HARNESS_INTENTS)[number];

export const HARNESS_DEPTHS = ["shallow", "standard", "deep"] as const;
export type HarnessDepth = (typeof HARNESS_DEPTHS)[number];

export const clarifyOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
});

export const clarifyQuestionSchema = z.object({
  id: z.string().min(1).max(64),
  prompt: z.string().min(1).max(400),
  options: z.array(clarifyOptionSchema).min(2).max(5).optional(),
});

export const classificationSchema = z.object({
  intent: z.enum(HARNESS_INTENTS),
  depth: z.enum(HARNESS_DEPTHS),
  needsClarify: z.boolean(),
  questions: z.array(clarifyQuestionSchema).max(3).default([]),
  planSteps: z.array(z.string().min(1).max(200)).max(6).optional(),
  rationale: z.string().max(400).optional(),
});

export type ClarifyOption = z.infer<typeof clarifyOptionSchema>;
export type ClarifyQuestion = z.infer<typeof clarifyQuestionSchema>;
export type HarnessClassification = z.infer<typeof classificationSchema>;

/** Sent from client → /api/chat so the run uses the right budget. */
export type HarnessChatContext = {
  intent: HarnessIntent;
  depth: HarnessDepth;
  runId?: string;
  /** Answers keyed by question id (option id or free text). */
  clarifications?: Record<string, string>;
  /** Deep-path plan from classify — injected into the chat system prompt. */
  planSteps?: string[];
  /** Soft wall-clock minutes when the user stated a deadline ("5 minutes"). */
  timeBudgetMinutes?: number;
  /** Surface mode — same harness, different default posture later for Agent UI. */
  surface?: "chat" | "agent";
};

export type HarnessRunStatus =
  | "clarifying"
  | "planning"
  | "acting"
  | "verifying"
  | "done"
  | "blocked_on_user";
