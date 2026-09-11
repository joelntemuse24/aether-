import type { SpeedTier } from "../../src/lib/hosted/speed-tiers";

export type ProbeCategory =
  | "math"
  | "cite-search"
  | "fetch-extract"
  | "pptx-xlsx"
  | "github-list"
  | "time-dublin"
  | "research-deep"
  | "blank-survival";

export type ProbeSurface = "api" | "ui";

export type ProbeFailureCode =
  | "empty_transcript"
  | "raw_tool_markup"
  | "client_exception"
  | "application_error"
  | "step_failed"
  | "step_failed_no_recovery"
  | "zoneinfo_error"
  | "stuck_stop"
  | "duplicate_working"
  | "missing_worked_for"
  | "blank_howzit"
  | "no_answer_timeout"
  | "http_error";

export type ProbePrompt = {
  id: string;
  category: ProbeCategory;
  prompt: string;
  tiers: SpeedTier[];
  smoke?: boolean;
  timeoutMs?: number;
  enabled?: boolean;
  source?: string;
  notes?: string;
  /** Defaults to api+ui so harvested prompts drop in without a code change. */
  surfaces?: ProbeSurface[];
};

export type ProbePack = {
  version: number;
  notes?: string;
  seeds: ProbePrompt[];
  harvested: ProbePrompt[];
};

export type TranscriptSnapshot = {
  promptId: string;
  category: ProbeCategory;
  tier: SpeedTier;
  prompt: string;
  visibleText: string;
  rawText: string;
  eventTypes: string[];
  httpStatus: number | null;
  httpError: string | null;
  clientException: string | null;
  elapsedMs: number;
  timedOut: boolean;
  finished: boolean;
  workingStripCount: number;
};

export type ProbeFinding = {
  code: ProbeFailureCode;
  detail: string;
};

export type ProbeCaseResult = {
  id: string;
  category: ProbeCategory;
  tier: SpeedTier;
  prompt: string;
  passed: boolean;
  findings: ProbeFinding[];
  elapsedMs: number;
  timedOut: boolean;
  httpStatus: number | null;
  excerpt: string;
  transport: "request" | "head-start" | "fixture" | "ui";
  surface: ProbeSurface;
  screenshot?: string | null;
};

export type ProbeReport = {
  generatedAt: string;
  mode: "offline-fixtures" | "live";
  subset: "smoke" | "full";
  baseUrl: string | null;
  chatTransport: "request" | "durable" | null;
  hostedAvailable: boolean | null;
  tiers: SpeedTier[];
  totals: { runs: number; passed: number; failed: number };
  failures: ProbeCaseResult[];
  results: ProbeCaseResult[];
};

export const REQUIRED_CATEGORIES: readonly ProbeCategory[] = [
  "math",
  "cite-search",
  "fetch-extract",
  "pptx-xlsx",
  "github-list",
  "time-dublin",
  "research-deep",
  "blank-survival",
];
