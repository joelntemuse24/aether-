import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { budgetForDepth } from "./budgets";
import { heuristicClassify } from "./heuristic";

describe("heuristicClassify quantitative research", () => {
  it("treats Ireland office vs hospitality as research with room to search then answer", () => {
    const classification = heuristicClassify(
      "How many people in Ireland work in an office vs hospitality",
    );
    assert.equal(classification.intent, "research");
    assert.equal(classification.depth, "standard");
    assert.ok(budgetForDepth(classification.depth).maxSteps >= 8);
    assert.equal(classification.needsClarify, false);
  });

  it("does not send a clock question down the deep research loop", () => {
    const classification = heuristicClassify("What time is it in Dublin?");
    assert.notEqual(classification.intent, "research");
    assert.equal(classification.depth, "shallow");
    assert.equal(budgetForDepth(classification.depth).maxSteps, 2);
  });
});
