import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_REPORT_JSON, DEFAULT_REPORT_MD } from "./report";
import { runProbe } from "./run";

describe("probe runner", () => {
  it("writes a passing offline smoke report without calling hosted chat", async () => {
    const report = await runProbe({ smoke: true, offline: true });
    assert.equal(report.mode, "offline-fixtures");
    assert.equal(report.subset, "smoke");
    assert.equal(report.tiers[0], "fast");
    assert.ok(report.totals.runs >= 1 && report.totals.runs <= 3);
    assert.equal(report.totals.failed, 0);
    const json = JSON.parse(readFileSync(DEFAULT_REPORT_JSON, "utf8")) as {
      totals: { failed: number };
    };
    assert.equal(json.totals.failed, 0);
    assert.match(readFileSync(DEFAULT_REPORT_MD, "utf8"), /No failures/);
  });
});
