import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countWorkingStrips, detectFailures } from "./detectors";
import { fixtureSnapshot } from "./client";
import type { TranscriptSnapshot } from "./types";

function snap(
  override: Partial<TranscriptSnapshot> & { visibleText?: string },
): TranscriptSnapshot {
  return fixtureSnapshot({
    promptId: "t",
    category: "math",
    tier: "fast",
    prompt: "2+2",
    finished: true,
    ...override,
  });
}

describe("probe failure detectors", () => {
  it("passes a normal prose answer", () => {
    const findings = detectFailures(snap({ visibleText: "The product is 391." }));
    assert.deepEqual(findings, []);
  });

  it("flags an empty transcript after send", () => {
    const findings = detectFailures(snap({ visibleText: "   ", rawText: "" }));
    assert.equal(findings.some((f) => f.code === "empty_transcript"), true);
  });

  it("flags raw DSML / tool XML in the transcript", () => {
    const dsml =
      '<|DSML| tool_search query="current time Dublin Ireland"><|/DSML| tool_search>';
    const findings = detectFailures(
      snap({ visibleText: dsml, rawText: dsml, category: "time-dublin" }),
    );
    assert.equal(findings.some((f) => f.code === "raw_tool_markup"), true);
  });

  it("flags Application error and client exceptions", () => {
    const app = detectFailures(
      snap({ visibleText: "Application error: a client-side exception has occurred" }),
    );
    assert.equal(app.some((f) => f.code === "application_error"), true);

    const ex = detectFailures(
      snap({
        visibleText: "hello",
        clientException: "TypeError: Cannot read properties of null",
      }),
    );
    assert.equal(ex.some((f) => f.code === "client_exception"), true);
  });

  it("flags This step failed, ZoneInfo, and stuck Stop", () => {
    assert.equal(
      detectFailures(snap({ visibleText: "This step failed" })).some(
        (f) => f.code === "step_failed",
      ),
      true,
    );
    assert.equal(
      detectFailures(
        snap({
          category: "time-dublin",
          visibleText: "ZoneInfoNotFoundError: 'Europe/Dublin'",
        }),
      ).some((f) => f.code === "zoneinfo_error"),
      true,
    );
    assert.equal(
      detectFailures(snap({ visibleText: "composer stuck Stop" })).some(
        (f) => f.code === "stuck_stop",
      ),
      true,
    );
  });

  it("flags duplicate Working strips but allows a single Working plus an answer", () => {
    assert.equal(countWorkingStrips("Working\nWorking for 12s"), 2);
    const dup = detectFailures(
      snap({
        visibleText: "Working\nWorking for 8s",
        workingStripCount: 2,
      }),
    );
    assert.equal(dup.some((f) => f.code === "duplicate_working"), true);

    const ok = detectFailures(
      snap({
        visibleText: "Working for 3s\nIt is 15:02 in Dublin (Europe/Dublin).",
        workingStripCount: 1,
      }),
    );
    assert.equal(ok.some((f) => f.code === "duplicate_working"), false);
    assert.equal(ok.some((f) => f.code === "empty_transcript"), false);
  });

  it("flags no answer after timeout", () => {
    const findings = detectFailures(
      snap({
        visibleText: "",
        timedOut: true,
        finished: false,
        elapsedMs: 45_000,
      }),
    );
    assert.equal(findings.some((f) => f.code === "no_answer_timeout"), true);
    assert.equal(findings.some((f) => f.code === "empty_transcript"), false);
  });

  it("flags stuck Stop when the turn dies on Working", () => {
    const findings = detectFailures(
      snap({
        visibleText: "Working",
        timedOut: true,
        finished: false,
        workingStripCount: 1,
        elapsedMs: 60_000,
      }),
    );
    assert.equal(findings.some((f) => f.code === "stuck_stop"), true);
  });

  it("flags a leaked upstream auth error even when HTTP is 200", () => {
    const findings = detectFailures(
      snap({
        visibleText: "Missing Authentication header",
        httpStatus: 200,
        httpError: null,
      }),
    );
    assert.equal(findings.some((f) => f.code === "http_error"), true);
  });

  it("does not treat a time answer as a ZoneInfo failure", () => {
    const findings = detectFailures(
      snap({
        category: "time-dublin",
        visibleText: "16:40 IST, Europe/Dublin — no zone database error.",
      }),
    );
    assert.equal(findings.some((f) => f.code === "zoneinfo_error"), false);
  });
});
