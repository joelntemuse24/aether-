import { looksLikeRawToolMarkup } from "../../src/lib/visible-chat-text";
import type {
  ProbeFinding,
  TranscriptSnapshot,
} from "./types";

const APPLICATION_ERROR = /application error/i;
const STEP_FAILED = /this step failed/i;
const ZONEINFO = /zoneinfonotfounderror/i;
const STUCK_STOP = /\bstuck stop\b|\bstop stuck\b/i;
const WORKING_LINE = /^(?:working(?: for \S+)?)$/i;

export function countWorkingStrips(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (WORKING_LINE.test(line.trim())) count += 1;
  }
  return count;
}

export function detectFailures(snap: TranscriptSnapshot): ProbeFinding[] {
  const findings: ProbeFinding[] = [];
  const visible = snap.visibleText.trim();
  const haystack = [
    snap.visibleText,
    snap.rawText,
    snap.httpError ?? "",
    snap.clientException ?? "",
  ].join("\n");

  if (snap.clientException?.trim()) {
    findings.push({
      code: "client_exception",
      detail: snap.clientException.trim().slice(0, 400),
    });
  }

  if (
    snap.httpStatus !== null &&
    snap.httpStatus >= 400 &&
    !findings.some((f) => f.code === "client_exception")
  ) {
    findings.push({
      code: "http_error",
      detail: `${snap.httpStatus}${snap.httpError ? ` ${snap.httpError}` : ""}`.slice(
        0,
        400,
      ),
    });
  }

  if (APPLICATION_ERROR.test(haystack)) {
    findings.push({
      code: "application_error",
      detail: "Visible text or transport error contains “Application error”.",
    });
  }

  if (looksLikeRawToolMarkup(snap.visibleText) || looksLikeRawToolMarkup(snap.rawText)) {
    findings.push({
      code: "raw_tool_markup",
      detail: "Raw DSML or tool XML appeared in the assistant transcript.",
    });
  }

  if (STEP_FAILED.test(haystack)) {
    findings.push({
      code: "step_failed",
      detail: "Transcript contains “This step failed”.",
    });
  }

  if (ZONEINFO.test(haystack)) {
    findings.push({
      code: "zoneinfo_error",
      detail: "ZoneInfoNotFoundError appeared (time/Dublin must not throw).",
    });
  }

  if (STUCK_STOP.test(haystack)) {
    findings.push({
      code: "stuck_stop",
      detail: "Stuck Stop surfaced in the transcript or error.",
    });
  }

  const working =
    snap.workingStripCount > 0
      ? snap.workingStripCount
      : countWorkingStrips(snap.visibleText);
  if (working >= 2) {
    findings.push({
      code: "duplicate_working",
      detail: `Saw ${working} Working strips (expected at most one).`,
    });
  }

  if (snap.timedOut && !visible) {
    findings.push({
      code: "no_answer_timeout",
      detail: `No answer after ${snap.elapsedMs}ms.`,
    });
  }

  if (!visible && !snap.timedOut && !findings.some((f) => f.code === "http_error")) {
    findings.push({
      code: "empty_transcript",
      detail: "Blank / empty assistant transcript after send.",
    });
  }

  if (
    snap.timedOut &&
    !snap.finished &&
    visible &&
    working >= 1 &&
    visible.replace(WORKING_LINE, "").trim().length === 0
  ) {
    findings.push({
      code: "stuck_stop",
      detail: "Timed out on Working with no answer (stuck Stop).",
    });
  }

  return dedupeFindings(findings);
}

function dedupeFindings(findings: ProbeFinding[]): ProbeFinding[] {
  const seen = new Set<string>();
  const out: ProbeFinding[] = [];
  for (const finding of findings) {
    if (seen.has(finding.code)) continue;
    seen.add(finding.code);
    out.push(finding);
  }
  return out;
}
