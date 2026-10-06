import assert from "node:assert/strict";
import { beforeEach, it } from "node:test";
import {
  CONFIGURED_SKILLS_FAILURE_TTL_MS,
  CONFIGURED_SKILLS_TTL_MS,
  configuredTrueForgeSkillNames,
  mountedTrueForgeSkills,
  optedInTrueForgeSkills,
  resetConfiguredSkillsCache,
  seedAetherSkills,
  SAFE_TRUEFORGE_SKILLS,
} from "./skills";
import { buildTrueForgeAgentSpec, hostedRuntimeKey } from "./sessions";

beforeEach(() => resetConfiguredSkillsCache());

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

it("mounts only configured names that are also opted in", () => {
  const input = { modelName: "buzz/gpt-5-6-luna", instructions: "Answer", mcp: null, sandboxEnabled: true };
  assert.deepEqual(mountedTrueForgeSkills(true, {}, ["web-artifacts-builder", "other"]), ["web-artifacts-builder"]);
  assert.deepEqual(mountedTrueForgeSkills(true, { AETHER_TRUEFORGE_SKILLS: "off" }, ["web-artifacts-builder"]), []);
  assert.deepEqual(
    buildTrueForgeAgentSpec({ ...input, seededSkillNames: ["other", "web-artifacts-builder"] }).spec.skills,
    [{ name: "web-artifacts-builder" }],
  );
  assert.equal("skills" in buildTrueForgeAgentSpec({ ...input, seededSkillNames: ["other"] }).spec, false);
});

it("keys the hosted runtime on the configured skills", () => {
  assert.match(hostedRuntimeKey(true, ["web-artifacts-builder"]), /:skillsweb-artifacts-builder$/);
  assert.match(hostedRuntimeKey(true, []), /:skills$/);
  assert.match(hostedRuntimeKey(false, ["web-artifacts-builder"]), /:skills$/);
});

it("lists configured skill names and caches them briefly", async () => {
  let calls = 0;
  const list = async () => { calls++; return ["web-artifacts-builder"]; };
  assert.deepEqual(await configuredTrueForgeSkillNames(list, 1000), ["web-artifacts-builder"]);
  assert.deepEqual(await configuredTrueForgeSkillNames(list, 1000 + CONFIGURED_SKILLS_TTL_MS - 1), ["web-artifacts-builder"]);
  assert.equal(calls, 1);
  await configuredTrueForgeSkillNames(list, 1000 + CONFIGURED_SKILLS_TTL_MS);
  assert.equal(calls, 2);
});

it("mounts no skills when the list is empty or fails", async () => {
  assert.deepEqual(await configuredTrueForgeSkillNames(async () => [], 0), []);
  assert.deepEqual(mountedTrueForgeSkills(true, {}, await configuredTrueForgeSkillNames(async () => [], 0)), []);
  resetConfiguredSkillsCache();
  let calls = 0;
  const failing = async (): Promise<string[]> => { calls++; throw new Error("offline"); };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await configuredTrueForgeSkillNames(failing, 0), []);
    assert.deepEqual(await configuredTrueForgeSkillNames(failing, CONFIGURED_SKILLS_FAILURE_TTL_MS - 1), []);
    assert.equal(calls, 1);
    assert.deepEqual(await configuredTrueForgeSkillNames(async () => ["web-artifacts-builder"], CONFIGURED_SKILLS_FAILURE_TTL_MS), ["web-artifacts-builder"]);
  } finally {
    console.warn = warn;
  }
});
