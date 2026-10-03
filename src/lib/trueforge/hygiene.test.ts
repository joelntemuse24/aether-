import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("repo hygiene", () => {
  it("typechecks application code without the test fixtures", () => {
    const tsconfig = readFileSync(new URL("../../../tsconfig.json", import.meta.url), "utf8");
    assert.match(tsconfig, /\*\*\/\*\.test\.ts/);
    const docker = readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8");
    const sidecar = readFileSync(new URL("../../../deploy/trueforge/Dockerfile", import.meta.url), "utf8");
    assert.match(docker, /node:22\.14/);
    assert.match(sidecar, /node:22\.14/);
    assert.match(docker, /Deprecated/);
    const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
    assert.match(readme, /railway\.toml` are \*\*deprecated\*\*/);
    const route = readFileSync(new URL("../../app/api/chat/route.ts", import.meta.url), "utf8");
    assert.match(route, /engine: "trueforge"/);
    assert.match(route, /engine: "legacy"/);
    const web = readFileSync(new URL("../web-search.ts", import.meta.url), "utf8");
    assert.equal(web.includes("async function searchBrave"), false);
    const adapter = readFileSync(new URL("../local-thread-adapter.tsx", import.meta.url), "utf8");
    assert.equal(adapter.includes("AI_SDK_FORMAT"), false);
    const probe = readFileSync(new URL("../../../evals/probe/run.ts", import.meta.url), "utf8");
    assert.equal(probe.includes("_smoke"), false);
  });
});
