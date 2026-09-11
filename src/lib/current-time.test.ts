import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCurrentTime } from "./current-time";

describe("current_time", () => {
  it("resolves Europe/Dublin without Python or tzdata", () => {
    const now = new Date("2026-09-11T15:52:00.000Z");
    const result = resolveCurrentTime({ timeZone: "Europe/Dublin", now });
    assert.equal(result.ok, true);
    assert.equal(result.timeZone, "Europe/Dublin");
    assert.match(result.local, /2026|Dublin|IST|GMT|September|11/i);
    assert.equal(result.iso, now.toISOString());
    assert.doesNotMatch(JSON.stringify(result), /OpenRouter|Buzz|Nemotron|Vercel/);
  });

  it("rejects an unknown IANA zone honestly", () => {
    const result = resolveCurrentTime({ timeZone: "Not/AZone" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /timezone|zone/i);
  });
});
