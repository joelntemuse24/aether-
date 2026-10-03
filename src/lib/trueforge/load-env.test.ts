import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadLocalEnvFiles, parseEnvAssignment } from "./load-env";

describe("local env files", () => {
  it("strips inline comments and accepts export", () => {
    assert.deepEqual(parseEnvAssignment("export TRUEFORGE_PORT=8790 # public"), {
      key: "TRUEFORGE_PORT",
      value: "8790",
    });
    assert.deepEqual(parseEnvAssignment("AETHER_APP_URL=https://aether.example # prod"), {
      key: "AETHER_APP_URL",
      value: "https://aether.example",
    });
    assert.deepEqual(parseEnvAssignment('QUOTED="keep # this"'), {
      key: "QUOTED",
      value: "keep # this",
    });
    assert.equal(parseEnvAssignment("# export SKIP=1"), null);
    assert.equal(parseEnvAssignment("export =nope"), null);
  });

  it("loads export and comments from a file without overriding the process", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aether-env-"));
    writeFileSync(
      path.join(dir, ".env"),
      "export AETHER_ENV_PROBE=from-file # comment\nALREADY=file\n",
    );
    const previousProbe = process.env.AETHER_ENV_PROBE;
    const previousAlready = process.env.ALREADY;
    process.env.ALREADY = "process";
    delete process.env.AETHER_ENV_PROBE;
    try {
      loadLocalEnvFiles(dir);
      assert.equal(process.env.AETHER_ENV_PROBE, "from-file");
      assert.equal(process.env.ALREADY, "process");
    } finally {
      if (previousProbe === undefined) delete process.env.AETHER_ENV_PROBE;
      else process.env.AETHER_ENV_PROBE = previousProbe;
      if (previousAlready === undefined) delete process.env.ALREADY;
      else process.env.ALREADY = previousAlready;
    }
  });
});
