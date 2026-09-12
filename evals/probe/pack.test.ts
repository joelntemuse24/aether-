import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandCases,
  loadProbePack,
  packCoverageErrors,
  selectPrompts,
} from "./pack";
import {
  MIN_HARVESTED_PROMPTS,
  REQUIRED_HARVEST_CATEGORIES,
} from "./types";

describe("probe pack", () => {
  it("ships 8–12 seeds covering every required category plus the Grok-history harvest", () => {
    const pack = loadProbePack();
    assert.deepEqual(packCoverageErrors(pack), []);
    assert.ok(pack.seeds.length >= 8 && pack.seeds.length <= 12);
    assert.ok(pack.harvested.length >= MIN_HARVESTED_PROMPTS);
    assert.equal(pack.harvestSource, "grok-history");
    assert.equal(pack.harvestedAt, "2026-09-11T16:56:00Z");
    assert.ok(pack.harvested.every((h) => h.enabled !== false));
    assert.ok(pack.harvested.every((h) => h.prompt.trim().length > 0));
    assert.ok(pack.harvested.every((h) => h.source === "grok-history"));
    assert.ok(pack.harvested.every((h) => h.smoke !== true));
    assert.ok(
      pack.harvested.every((h) => (h.surfaces ?? []).includes("ui")),
      "harvested rows must accept a UI drop-in",
    );
    assert.ok(
      pack.harvested.every((h) => (h.surfaces ?? []).includes("api")),
      "harvested rows must stay on the API surface",
    );
    const harvestCats = new Set(pack.harvested.map((h) => h.category));
    for (const cat of REQUIRED_HARVEST_CATEGORIES) {
      assert.ok(harvestCats.has(cat), `missing harvest category ${cat}`);
    }
  });

  it("keeps harvest category labels instead of remapping onto seed cats", () => {
    const pack = loadProbePack();
    const remapped = pack.harvested.filter((h) =>
      [
        "math",
        "cite-search",
        "fetch-extract",
        "pptx-xlsx",
        "github-list",
        "time-dublin",
        "research-deep",
        "blank-survival",
      ].includes(h.category),
    );
    assert.equal(remapped.length, 0);
  });

  it("keeps the smoke subset small", () => {
    const pack = loadProbePack();
    const smoke = selectPrompts(pack, { smoke: true });
    assert.ok(smoke.length >= 1 && smoke.length <= 3);
    assert.ok(smoke.every((p) => p.smoke === true));
    assert.ok(smoke.every((p) => p.source !== "grok-history"));
    const cases = expandCases(smoke, ["expert"]);
    assert.equal(cases.length, smoke.length);
    assert.ok(cases.every((c) => c.tier === "expert"));
  });

  it("includes harvested prompts on --all without a runner change", () => {
    const pack = loadProbePack();
    const all = selectPrompts(pack, {});
    assert.ok(all.some((p) => p.id === "grok-head-start-bullets"));
    assert.ok(all.some((p) => p.id === "grok-time-dublin"));
    assert.ok(all.filter((p) => p.source === "grok-history").length >= MIN_HARVESTED_PROMPTS);
    const ui = selectPrompts(pack, { surface: "ui" });
    assert.ok(ui.filter((p) => p.source === "grok-history").length >= MIN_HARVESTED_PROMPTS);
  });
});
