import assert from "node:assert/strict";
import { it } from "node:test";
import { mountedTrueForgeSkills, optedInTrueForgeSkills, seedAetherSkills, SAFE_TRUEFORGE_SKILLS } from "./skills";
import { buildTrueForgeAgentSpec } from "./sessions";

it("filters env opt-ins to the real safe catalog", () => {
  assert.deepEqual(optedInTrueForgeSkills({}), ["web-artifacts-builder"]);
  assert.deepEqual(optedInTrueForgeSkills({ AETHER_TRUEFORGE_SKILLS: "" }), ["web-artifacts-builder"]);
  for (const value of ["0", "off", "false", "OFF", "xlsx,docx,unknown"]) {
    assert.deepEqual(optedInTrueForgeSkills({ AETHER_TRUEFORGE_SKILLS: value }), []);
  }
  assert.deepEqual(optedInTrueForgeSkills({ AETHER_TRUEFORGE_SKILLS: "fake, web-artifacts-builder,web-artifacts-builder" }), ["web-artifacts-builder"]);
  assert.deepEqual(mountedTrueForgeSkills(false, {}), []);
  assert.deepEqual(mountedTrueForgeSkills(true, {}, []), []);
  assert.deepEqual(mountedTrueForgeSkills(true, {}, ["fake"]), []);
  assert.deepEqual(mountedTrueForgeSkills(true, {}, ["web-artifacts-builder"]), ["web-artifacts-builder"]);
});

it("seeds the complete git manifest and tolerates failures", async () => {
  const manifests: unknown[] = [];
  const seeded = await seedAetherSkills("http://unused", {}, async (manifest) => { manifests.push(manifest); });
  assert.deepEqual(seeded, ["web-artifacts-builder"]);
  assert.deepEqual(manifests, SAFE_TRUEFORGE_SKILLS);
  assert.deepEqual(await seedAetherSkills("http://unused", {}, async () => { throw new Error("offline"); }), []);
  assert.deepEqual(await seedAetherSkills("http://unused", { AETHER_TRUEFORGE_SKILLS: "off" }, async () => { assert.fail("should skip"); }), []);
});

it("omits the spec skills property without sandbox or successful registration", () => {
  const input = { modelName: "buzz/gpt-5-6-luna", instructions: "Answer", mcp: null, sandboxEnabled: true };
  assert.equal("skills" in buildTrueForgeAgentSpec({ ...input, seededSkillNames: [] }).spec, false);
  assert.equal("skills" in buildTrueForgeAgentSpec({ ...input, sandboxEnabled: false, seededSkillNames: ["web-artifacts-builder"] }).spec, false);
  assert.deepEqual(buildTrueForgeAgentSpec({ ...input, seededSkillNames: ["web-artifacts-builder"] }).spec.skills, [{ name: "web-artifacts-builder" }]);
});
