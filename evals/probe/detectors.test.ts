import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countWorkingStrips,
  detectFailures,
  snapshotResearchBudgetMs,
} from "./detectors";
import { fixtureSnapshot } from "./client";
import type { TranscriptSnapshot } from "./types";

function snap(
  override: Partial<TranscriptSnapshot> & { visibleText?: string },
): TranscriptSnapshot {
  return fixtureSnapshot({
    promptId: "t",
    category: "math",
    tier: "expert",
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

  it("flags empty synthesis when research finishes without a number or cite", () => {
    const findings = detectFailures(
      snap({
        category: "research",
        promptId: "grok-ireland-office-workers",
        prompt: "How many people in Ireland work in an office? As opposed to strictly hospitality…",
        visibleText:
          "I looked at several sources but couldn't really pin this down as a category.",
      }),
    );
    assert.equal(findings.some((f) => f.code === "empty_synthesis"), true);
  });

  it("passes grounded research with a number and a cite", () => {
    const findings = detectFailures(
      snap({
        category: "research",
        promptId: "grok-ireland-office-workers",
        visibleText:
          "Hospitality is about 178,000 [1]. Office-type professional + ICT is a proxy, not a CSO 'office' bucket [2].",
      }),
    );
    assert.equal(findings.some((f) => f.code === "empty_synthesis"), false);
  });

  it("flags vanished Working when a clock turn finishes blank", () => {
    const findings = detectFailures(
      snap({
        category: "time-dublin",
        promptId: "time-dublin",
        prompt: "What time is it in Dublin, Ireland right now? Include the timezone name.",
        visibleText: "",
        finished: true,
        workingStripCount: 0,
      }),
    );
    assert.equal(findings.some((f) => f.code === "empty_transcript"), true);
    assert.equal(findings.some((f) => f.code === "vanished_working"), true);
  });

  it("flags snapshot research that still takes Grok×5 wall time", () => {
    const budget = snapshotResearchBudgetMs({
      category: "cite-search",
      promptId: "cite-search-ireland-unemployment",
    });
    assert.ok(budget !== null && budget <= 35_000);

    const slow = detectFailures(
      snap({
        promptId: "cite-search-ireland-unemployment",
        category: "cite-search",
        prompt: "What is Ireland's latest published unemployment rate?",
        visibleText: "Ireland’s unemployment rate is 4.9% [1].",
        elapsedMs: 65_000,
        budgetMs: budget ?? undefined,
      }),
    );
    assert.equal(slow.some((f) => f.code === "slow_research"), true);

    const ok = detectFailures(
      snap({
        promptId: "cite-search-ireland-unemployment",
        category: "cite-search",
        prompt: "What is Ireland's latest published unemployment rate?",
        visibleText: "Ireland’s unemployment rate is 4.9% [1].",
        elapsedMs: 14_000,
        budgetMs: budget ?? undefined,
      }),
    );
    assert.equal(ok.some((f) => f.code === "slow_research"), false);
  });

  it("does not apply the snapshot budget to deep research-then-deck turns", () => {
    assert.equal(
      snapshotResearchBudgetMs({
        category: "research-deep",
        promptId: "research-deep-dublin-fund-admin",
      }),
      null,
    );
  });
});
