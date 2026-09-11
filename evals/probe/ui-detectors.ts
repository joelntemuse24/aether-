import { looksLikeRawToolMarkup } from "../../src/lib/visible-chat-text";
import type { ProbeFinding } from "./types";

export const WELCOME_PHRASES = ["Howzit?", "we uup", "in the trenches?"] as const;

export type UiSnapshot = {
  welcomeVisible: boolean;
  welcomePhrase: string | null;
  userMessageCount: number;
  assistantVisibleText: string;
  workingStripCount: number;
  workedForVisible: boolean;
  sawWorkingDuringTurn: boolean;
  stopVisible: boolean;
  sendVisible: boolean;
  stepFailedVisible: boolean;
  applicationErrorVisible: boolean;
  pageError: string | null;
  bodyText: string;
  elapsedMs: number;
  timedOut: boolean;
  finished: boolean;
};

export function isWelcomePhrase(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return (WELCOME_PHRASES as readonly string[]).includes(t);
}

export function detectUiFailures(snap: UiSnapshot): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  const assistant = snap.assistantVisibleText.trim();
  const haystack = [snap.bodyText, snap.assistantVisibleText, snap.pageError ?? ""].join(
    "\n",
  );

  if (snap.pageError?.trim()) {
    findings.push({
      code: "client_exception",
      detail: snap.pageError.trim().slice(0, 400),
    });
  }

  if (snap.applicationErrorVisible || /application error/i.test(haystack)) {
    findings.push({
      code: "application_error",
      detail: "Visible chrome shows “Application error” (client exception overlay).",
    });
  }

  if (looksLikeRawToolMarkup(snap.assistantVisibleText) || looksLikeRawToolMarkup(haystack)) {
    findings.push({
      code: "raw_tool_markup",
      detail: "Raw DSML or tool XML is visible in the thread chrome.",
    });
  }

  if (snap.welcomeVisible && snap.userMessageCount === 0) {
    findings.push({
      code: "blank_howzit",
      detail: `Welcome “${snap.welcomePhrase ?? "Howzit?"}” still showing and the send vanished (blank after send).`,
    });
  } else if (snap.welcomeVisible && snap.userMessageCount > 0) {
    findings.push({
      code: "blank_howzit",
      detail: "Howzit welcome stayed up after a user message left the composer.",
    });
  }

  if (!assistant && !snap.timedOut && snap.userMessageCount > 0 && !snap.welcomeVisible) {
    findings.push({
      code: "empty_transcript",
      detail: "User message is on the thread but the assistant bubble is blank.",
    });
  }

  if (snap.workingStripCount >= 2) {
    findings.push({
      code: "duplicate_working",
      detail: `Saw ${snap.workingStripCount} Working strips in the UI (expected at most one).`,
    });
  }

  if (snap.stopVisible && snap.timedOut) {
    findings.push({
      code: "stuck_stop",
      detail: "Stop is still the composer face after the probe timeout (stuck Stop).",
    });
  } else if (snap.stopVisible && snap.finished && !snap.timedOut && !assistant) {
    findings.push({
      code: "stuck_stop",
      detail: "Stop stayed latched with no assistant answer.",
    });
  }

  if (snap.sawWorkingDuringTurn && snap.finished && !snap.stopVisible && !snap.workedForVisible) {
    findings.push({
      code: "missing_worked_for",
      detail: "Turn showed Working but never collapsed to “Worked for Ns”.",
    });
  }

  if (snap.stepFailedVisible && !assistant) {
    findings.push({
      code: "step_failed_no_recovery",
      detail: "“This step failed” is visible and the thread did not recover with an answer.",
    });
  } else if (snap.stepFailedVisible) {
    findings.push({
      code: "step_failed",
      detail: "“This step failed” is visible in the tool trace.",
    });
  }

  if (snap.timedOut && !assistant) {
    findings.push({
      code: "no_answer_timeout",
      detail: `No visible answer in the UI after ${snap.elapsedMs}ms.`,
    });
  }

  if (
    /missing authentication header|incorrect api key|invalid api key|ai_apicallerror/i.test(
      haystack,
    )
  ) {
    findings.push({
      code: "http_error",
      detail: "Upstream / auth error is visible in the thread chrome.",
    });
  }

  if (/zoneinfonotfounderror/i.test(haystack)) {
    findings.push({
      code: "zoneinfo_error",
      detail: "ZoneInfoNotFoundError is visible in the UI.",
    });
  }

  return dedupe(findings);
}

function dedupe(findings: ProbeFinding[]): ProbeFinding[] {
  const seen = new Set<string>();
  const out: ProbeFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.code)) continue;
    seen.add(finding.code);
    out.push(finding);
  }
  return out;
}

export function fixtureUiSnapshot(
  partial: Partial<UiSnapshot> = {},
): UiSnapshot {
  return {
    welcomeVisible: false,
    welcomePhrase: null,
    userMessageCount: 1,
    assistantVisibleText: "Hello — I am here and ready.",
    workingStripCount: 0,
    workedForVisible: true,
    sawWorkingDuringTurn: true,
    stopVisible: false,
    sendVisible: true,
    stepFailedVisible: false,
    applicationErrorVisible: false,
    pageError: null,
    bodyText: "Hello — I am here and ready. Worked for 2s",
    elapsedMs: 40,
    timedOut: false,
    finished: true,
    ...partial,
  };
}
