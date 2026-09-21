import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { budgetForDepth } from "./budgets";
import { heuristicClassify } from "./heuristic";

describe("heuristicClassify snapshot research", () => {
  it("keeps Ireland unemployment cite prompts on standard depth, not deep", () => {
    const ireland = heuristicClassify(
      "What is Ireland's latest published unemployment rate? Use web search, cite sources with inline [1] [2], and list the URLs.",
    );
    assert.equal(ireland.intent, "research");
    assert.equal(ireland.depth, "standard");
    assert.equal(ireland.planSteps, undefined);
    assert.equal(budgetForDepth(ireland.depth).maxSteps, 8);

    const grok = heuristicClassify(
      "Search the web for Ireland’s current unemployment rate and cite one source.",
    );
    assert.equal(grok.intent, "research");
    assert.equal(grok.depth, "standard");
    assert.equal(budgetForDepth(grok.depth).maxSteps, 8);
  });

  it("still uses deep budget for decks, compares, and explicit deep dives", () => {
    const deck = heuristicClassify(
      "Research Dublin junior investment-ops market Sep 2026 and give me a real .pptx.",
    );
    assert.equal(deck.intent, "research");
    assert.equal(deck.depth, "deep");
    assert.ok(budgetForDepth(deck.depth).maxSteps >= 16);

    const compare = heuristicClassify(
      "Compare two current approaches to fund administration in Dublin. Use web search, then write a short sourced brief with inline [1] [2] citations.",
    );
    assert.equal(compare.intent, "research");
    assert.equal(compare.depth, "deep");

    const thorough = heuristicClassify(
      "Do a thorough deep dive into Ireland labour-force statistics with sources.",
    );
    assert.equal(thorough.intent, "research");
    assert.equal(thorough.depth, "deep");
  });
});
