import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  depthUnderTimePressure,
  parseTimeBudgetFromText,
  timeBudgetForMinutes,
} from "./time-budget";

describe("parseTimeBudgetFromText", () => {
  it("parses in N minutes", () => {
    const b = parseTimeBudgetFromText(
      "I need this essay in 5 minutes for my portal",
    );
    assert.ok(b);
    assert.equal(b!.minutes, 5);
    assert.equal(b!.forceEarlyDraft, true);
    assert.equal(b!.maxSearches, 1);
  });

  it("parses have N min", () => {
    const b = parseTimeBudgetFromText("I only have 12 min left");
    assert.ok(b);
    assert.equal(b!.minutes, 12);
    assert.equal(b!.maxSearches, 2);
  });

  it("treats urgent as 5 minutes", () => {
    const b = parseTimeBudgetFromText("This is urgent, submit ASAP");
    assert.ok(b);
    assert.equal(b!.minutes, 5);
  });

  it("returns null without time pressure", () => {
    assert.equal(parseTimeBudgetFromText("Write a calm overview of cats"), null);
  });
});

describe("depthUnderTimePressure", () => {
  it("caps deep to standard under 5 minutes", () => {
    const tb = timeBudgetForMinutes(5);
    assert.equal(depthUnderTimePressure("deep", tb), "standard");
    assert.equal(depthUnderTimePressure("standard", tb), "standard");
  });
});
