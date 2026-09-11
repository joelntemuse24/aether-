import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandCases,
  loadProbePack,
  packCoverageErrors,
  selectPrompts,
} from "./pack";

describe("probe pack", () => {
  it("ships 8–12 seeds covering every required category plus harvest placeholders", () => {
    const pack = loadProbePack();
    assert.deepEqual(packCoverageErrors(pack), []);
    assert.ok(pack.seeds.length >= 8 && pack.seeds.length <= 12);
    assert.ok(pack.harvested.length >= 2);
    assert.ok(pack.harvested.every((h) => h.enabled === false));
    assert.ok(pack.harvested.every((h) => h.prompt === ""));
  });

  it("keeps the smoke subset small", () => {
    const pack = loadProbePack();
    const smoke = selectPrompts(pack, { smoke: true });
    assert.ok(smoke.length >= 1 && smoke.length <= 3);
    assert.ok(smoke.every((p) => p.smoke === true));
    const cases = expandCases(smoke, ["fast"]);
    assert.equal(cases.length, smoke.length);
    assert.ok(cases.every((c) => c.tier === "fast"));
  });

  it("can drop in harvested prompts later without changing the runner", () => {
    const pack = loadProbePack();
    pack.harvested[0] = {
      ...pack.harvested[0],
      enabled: true,
      prompt: "Hard harvested prompt",
    };
    const all = selectPrompts(pack, {});
    assert.ok(all.some((p) => p.id === pack.harvested[0].id));
  });
});
