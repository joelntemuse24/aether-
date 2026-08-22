import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Railway gateway deploy contract", () => {
  const dockerfile = read("deploy/hermes/Dockerfile");
  const rootDockerfile = read("Dockerfile");
  const railwayToml = read("railway.toml");
  const nestedToml = read("deploy/hermes/railway.toml");
  const seed = read("deploy/hermes/seed/config.yaml");
  const envExample = read("deploy/hermes/.env.example");
  const cmd = read("deploy/hermes/railway-cmd.sh");
  const readme = read("deploy/hermes/README.md");
  const compose = read("deploy/hermes/docker-compose.example.yml");

  it("keeps the root Dockerfile identical so Railway cannot Railpack Next.js", () => {
    assert.equal(rootDockerfile, dockerfile);
    assert.match(dockerfile, /^FROM nousresearch\/hermes-agent:latest$/m);
  });

  it("does not replace the official ENTRYPOINT", () => {
    assert.doesNotMatch(dockerfile, /^\s*ENTRYPOINT\b/m);
    assert.match(dockerfile, /CMD \["\/opt\/aether\/railway-cmd\.sh"\]/);
  });

  it("maps Railway PORT then execs official gateway run", () => {
    assert.match(cmd, /API_SERVER_PORT="\$PORT"/);
    assert.match(cmd, /exec hermes gateway run/);
    assert.doesNotMatch(cmd, /HERMES_DASHBOARD=1/);
  });

  it("omits startCommand from Railway config", () => {
    for (const toml of [railwayToml, nestedToml]) {
      assert.doesNotMatch(toml, /^\s*startCommand\s*=/m);
      assert.match(toml, /builder = "DOCKERFILE"/);
      assert.match(toml, /dockerfilePath = "deploy\/hermes\/Dockerfile"/);
      assert.match(toml, /healthcheckPath = "\/health"/);
      assert.match(toml, /restartPolicyType = "ON_FAILURE"/);
    }
  });

  it("seeds only documented Aether-required keys", () => {
    assert.match(seed, /direct_model_requests:\s*true/);
    assert.match(seed, /hard_stop_enabled:\s*true/);
    assert.match(seed, /provider:\s*openrouter/);
    assert.match(seed, /backend:\s*local/);
    assert.match(seed, /disabled_toolsets:[\s\S]*-\s*browser/);
    assert.doesNotMatch(seed, /API_SERVER_CORS_ORIGINS/);
    assert.doesNotMatch(seed, /sk-or-v1-/);
  });

  it("lists Railway vars without secrets or an open CORS origin", () => {
    assert.match(envExample, /API_SERVER_ENABLED=true/);
    assert.match(envExample, /API_SERVER_HOST=0\.0\.0\.0/);
    assert.match(envExample, /API_SERVER_KEY=/);
    assert.match(envExample, /OPENROUTER_API_KEY=/);
    assert.match(envExample, /HERMES_DASHBOARD=0/);
    assert.match(envExample, /HERMES_GATEWAY_BOOTSTRAP_STATE=running/);
    assert.match(envExample, /RAILWAY_DOCKERFILE_PATH=deploy\/hermes\/Dockerfile/);
    assert.match(envExample, /openssl rand -hex 32/);
    assert.match(envExample, /^HERMES_DASHBOARD=0$/m);
    assert.doesNotMatch(envExample, /^API_SERVER_CORS_ORIGINS=\*/m);
    assert.doesNotMatch(envExample, /sk-[a-zA-Z0-9]/);
  });

  it("README is a one-pass Railway trial guide for this repo", () => {
    assert.match(readme, /joelntemuse24\/aether-/);
    assert.match(readme, /RAILWAY_DOCKERFILE_PATH=deploy\/hermes\/Dockerfile/);
    assert.match(readme, /aether-seven-theta\.vercel\.app/);
    assert.match(readme, /openssl rand -hex 32/);
    assert.match(readme, /\/opt\/data/);
    assert.match(readme, /1 GB/);
    assert.match(readme, /HERMES_BASE_URL/);
    assert.match(readme, /HERMES_API_KEY/);
    assert.match(readme, /\/health/);
    assert.match(readme, /\/v1\/models/);
    assert.match(readme, /Do not set a Railway Start Command/);
    assert.match(readme, /HERMES_DASHBOARD=0/);
  });

  it("compose example uses /opt/data and leaves the dashboard off", () => {
    assert.match(compose, /hermes-data:\/opt\/data/);
    assert.match(compose, /HERMES_DASHBOARD: "0"/);
    assert.doesNotMatch(compose, /\/var\/run\/docker\.sock/);
    assert.doesNotMatch(compose, /["']9119:9119["']/);
  });
});
