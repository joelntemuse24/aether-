import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildReport, renderMarkdown, toCaseResult, writeReport } from "./report";

describe("probe report", () => {
  it("summarizes only failures in markdown", () => {
    const pass = toCaseResult({
      id: "blank-survival-hello",
      category: "blank-survival",
      tier: "fast",
      prompt: "hi",
      findings: [],
      elapsedMs: 20,
      timedOut: false,
      httpStatus: 200,
      visibleText: "Hello there.",
      transport: "fixture",
    });
    const fail = toCaseResult({
      id: "time-dublin",
      category: "time-dublin",
      tier: "expert",
      prompt: "time?",
      findings: [
        { code: "zoneinfo_error", detail: "ZoneInfoNotFoundError appeared." },
      ],
      elapsedMs: 800,
      timedOut: false,
      httpStatus: 200,
      visibleText: "ZoneInfoNotFoundError",
      transport: "request",
    });
    const report = buildReport({
      generatedAt: "2026-09-11T00:00:00.000Z",
      mode: "offline-fixtures",
      subset: "smoke",
      baseUrl: null,
      chatTransport: null,
      hostedAvailable: null,
      tiers: ["fast", "expert"],
      results: [pass, fail],
    });
    assert.equal(report.totals.failed, 1);
    assert.equal(report.failures[0]?.id, "time-dublin");
    const md = renderMarkdown(report);
    assert.match(md, /time-dublin/);
    assert.match(md, /zoneinfo_error/);
    assert.doesNotMatch(md, /### blank-survival-hello/);
  });

  it("writes last-report.json and markdown", () => {
    const dir = mkdtempSync(join(tmpdir(), "aether-probe-"));
    const report = buildReport({
      generatedAt: "2026-09-11T00:00:00.000Z",
      mode: "offline-fixtures",
      subset: "smoke",
      baseUrl: null,
      chatTransport: null,
      hostedAvailable: null,
      tiers: ["fast"],
      results: [
        toCaseResult({
          id: "math-final-price",
          category: "math",
          tier: "fast",
          prompt: "math",
          findings: [],
          elapsedMs: 10,
          timedOut: false,
          httpStatus: 200,
          visibleText: "110.16",
          transport: "fixture",
        }),
      ],
    });
    const paths = writeReport(
      report,
      join(dir, "last-report.json"),
      join(dir, "last-report.md"),
    );
    const json = JSON.parse(readFileSync(paths.jsonPath, "utf8")) as { totals: { passed: number } };
    assert.equal(json.totals.passed, 1);
    assert.match(readFileSync(paths.mdPath, "utf8"), /No failures/);
  });
});
