import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseScheduleWhen } from "./cron";

describe("parseScheduleWhen", () => {
  it("maps every morning to a daily 8:00 cron", () => {
    const parsed = parseScheduleWhen("every morning");
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.cron, "0 8 * * *");
      assert.equal(parsed.label, "Every morning");
    }
  });

  it("maps weekday mornings and evenings", () => {
    const weekdays = parseScheduleWhen("every weekday morning");
    assert.equal(weekdays.ok, true);
    if (weekdays.ok) assert.equal(weekdays.cron, "0 8 * * 1-5");
    const evening = parseScheduleWhen("every evening");
    assert.equal(evening.ok, true);
    if (evening.ok) assert.equal(evening.cron, "0 18 * * *");
  });

  it("accepts a 5-field cron and rejects junk", () => {
    const ok = parseScheduleWhen("30 7 * * 1");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.cron, "30 7 * * 1");
    assert.equal(parseScheduleWhen("not a schedule").ok, false);
    assert.equal(parseScheduleWhen("* * * * * *").ok, false);
  });
});
