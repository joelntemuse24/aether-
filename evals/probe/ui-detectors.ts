import { looksLikeRawToolMarkup } from "../../src/lib/visible-chat-text";
import { looksLikeThinkingTheater } from "../../src/lib/agent-activity";
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
  liveStepCount: number;
  pendingActivityVisible: boolean;
  messageActivityVisible: boolean;
  composerActivityVisible: boolean;
  liveToolTraceVisible: boolean;
  sourceTrayExpanded: boolean;
  stopVisible: boolean;
  sendVisible: boolean;
  stepFailedVisible: boolean;
  applicationErrorVisible: boolean;
  pageError: string | null;
  pathIsConversation: boolean;
  bodyText: string;
  elapsedMs: number;
  timedOut: boolean;
  finished: boolean;
};

export function isWelcomePhrase(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  return (WELCOME_PHRASES as readonly string[]).includes(t);
}

export function pathLooksLikeConversation(urlOrPath: string): boolean {
  const raw = (urlOrPath ?? "").trim();
  if (!raw) return false;
  try {
    const path = raw.includes("://") ? new URL(raw).pathname : raw;
    return /^\/c\/[^/]+/.test(path);
  } catch {
    return false;
  }
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
    if (snap.pathIsConversation) {
      findings.push({
        code: "remount_blank",
        detail:
          "Howzit came back after /c/<id> assignment — live turn remounted blank (no sidebar click needed).",
      });
    }
  } else if (snap.welcomeVisible && snap.userMessageCount > 0) {
    findings.push({
      code: "blank_howzit",
      detail: "Howzit welcome stayed up after a user message left the composer.",
    });
  }

  if (!assistant && !snap.timedOut && snap.userMessageCount > 0 && !snap.welcomeVisible) {
    findings.push({
      code: snap.pathIsConversation ? "remount_blank" : "empty_transcript",
      detail: snap.pathIsConversation
        ? "Live turn vanished after /c/<id> assignment (no sidebar click needed)."
        : "User message is on the thread but the assistant bubble is blank.",
    });
  }

  if (snap.workingStripCount >= 2) {
    findings.push({
      code: "duplicate_working",
      detail: `Saw ${snap.workingStripCount} Working strips in the UI (expected at most one).`,
    });
  }

  if (looksLikeThinkingTheater(haystack)) {
    findings.push({
      code: "thinking_theater",
      detail: "Decorative Thinking / Planning / Cooking copy is visible in the chrome.",
    });
  }

  if (snap.liveStepCount >= 2) {
    findings.push({
      code: "status_stack",
      detail: `Live status listed ${snap.liveStepCount} tool one-liners (expected a compact column of one).`,
    });
  }

  if (
    snap.composerActivityVisible ||
    (snap.pendingActivityVisible && snap.messageActivityVisible) ||
    snap.liveToolTraceVisible ||
    (snap.sourceTrayExpanded && snap.sawWorkingDuringTurn)
  ) {
    findings.push({
      code: "chip_jank",
      detail: snap.composerActivityVisible
        ? "Working/source chrome is inside the composer dock (jumps the input)."
        : snap.liveToolTraceVisible
          ? "A live tool body is expanding in the thread (jumps the composer)."
          : snap.pendingActivityVisible && snap.messageActivityVisible
            ? "Pending and message status are both visible (duplicate column)."
            : "Source tray expanded while Working was still on screen.",
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
    if (!assistant) {
      findings.push({
        code: "vanished_working",
        detail: "Turn showed Working, then vanished with an empty transcript.",
      });
    } else {
      findings.push({
        code: "missing_worked_for",
        detail: "Turn showed Working but never collapsed to “Worked for Ns”.",
      });
    }
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
    liveStepCount: 0,
    pendingActivityVisible: false,
    messageActivityVisible: false,
    composerActivityVisible: false,
    liveToolTraceVisible: false,
    sourceTrayExpanded: false,
    stopVisible: false,
    sendVisible: true,
    stepFailedVisible: false,
    applicationErrorVisible: false,
    pageError: null,
    pathIsConversation: false,
    bodyText: "Hello — I am here and ready. Worked for 2s",
    elapsedMs: 40,
    timedOut: false,
    finished: true,
    ...partial,
  };
}
