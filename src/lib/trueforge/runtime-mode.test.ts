import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildTrueForgeUpstreamEnv, trueforgeHostedEnvConfigured } from "./runtime-mode";

test("defaults to standalone mode", () => {
  const env = buildTrueForgeUpstreamEnv({ STANDALONE: "false" });
  assert.equal(trueforgeHostedEnvConfigured({}), false);
  assert.equal(env.STANDALONE, "true");
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.REDIS_URL, undefined);
});

test("maps the Contabo opt-in variables to hosted mode", () => {
  const env = buildTrueForgeUpstreamEnv({
    TRUEFORGE_DATABASE_URL: " postgres://db ",
    REDIS_URL: " redis://cache ",
    TRUEFORGE_API_KEY: "key",
  });
  assert.equal(trueforgeHostedEnvConfigured(env), true);
  assert.equal(env.STANDALONE, "false");
  assert.equal(env.DATABASE_URL, " postgres://db ");
  assert.equal(env.REDIS_URL, " redis://cache ");
  assert.equal(env.TRUEFORGE_API_KEY, "key");
});

test("requires both non-empty database and Redis variables", () => {
  for (const env of [
    { TRUEFORGE_DATABASE_URL: "postgres://db" },
    { REDIS_URL: "redis://cache" },
    { TRUEFORGE_DATABASE_URL: " ", REDIS_URL: "redis://cache" },
    { TRUEFORGE_DATABASE_URL: "postgres://db", REDIS_URL: "\t" },
  ]) {
    assert.equal(trueforgeHostedEnvConfigured(env), false);
    assert.equal(buildTrueForgeUpstreamEnv({ ...env, STANDALONE: "false" }).STANDALONE, "true");
  }
});

test("launchers use the shared mode helper", () => {
  for (const file of ["src/lib/trueforge/vm-server.ts", "src/lib/trueforge/dev-server.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /buildTrueForgeUpstreamEnv\(process\.env\)/);
    assert.doesNotMatch(source, /STANDALONE:\s*["']true["']/);
  }
});

test("supports fallback URLs and preserves the caller environment", () => {
  const input = { TRUEFORGE_DATABASE_URL: " ", DATABASE_URL: "postgres://db", REDIS_URL: " ", TRUEFORGE_REDIS_URL: "redis://cache", STANDALONE: "true", OTHER: "value" };
  const result = buildTrueForgeUpstreamEnv(input);
  assert.equal(result.STANDALONE, "false");
  assert.equal(result.DATABASE_URL, "postgres://db");
  assert.equal(result.REDIS_URL, "redis://cache");
  assert.equal(result.OTHER, "value");
  assert.equal(input.STANDALONE, "true");
  assert.equal(input.REDIS_URL, " ");
});
