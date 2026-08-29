import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Railway Next.js product deploy", () => {
  const railwayToml = read("railway.toml");
  const dockerfile = read("Dockerfile");
  const readme = read("README.md");
  const envExample = read(".env.example");

  it("runs next start as a long-lived Node process, not the Hermes image", () => {
    assert.match(railwayToml, /builder = "DOCKERFILE"/);
    assert.match(railwayToml, /dockerfilePath = "Dockerfile"/);
    assert.doesNotMatch(railwayToml, /deploy\/hermes\/Dockerfile/);
    assert.doesNotMatch(dockerfile, /nousresearch\/hermes-agent/);
    assert.match(dockerfile, /next start/);
    assert.match(dockerfile, /PORT/);
  });

  it("does not assume a Vercel function wall clock", () => {
    assert.doesNotMatch(railwayToml, /maxDuration/);
    assert.match(railwayToml, /healthcheckPath/);
    assert.match(railwayToml, /restartPolicyType = "ON_FAILURE"/);
  });

  it("documents Railway as the product deploy and Hermes as optional", () => {
    assert.match(readme, /Railway/);
    assert.match(readme, /next start/);
    assert.match(readme, /deprecated|optional/i);
    assert.match(envExample, /HERMES_ENABLED=1/);
    assert.match(envExample, /deprecated|optional|not the default/i);
    assert.match(envExample, /OPENROUTER_API_KEY/);
  });
});
