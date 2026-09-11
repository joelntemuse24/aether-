import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, buildChatHeaders, resolveModel } from "./settings";
import { FAST_OPENROUTER_MODEL } from "./hosted/speed-tiers";

describe("buildChatHeaders", () => {
  it("sends Ask by default and Auto when chosen", () => {
    const hosted = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
    });
    assert.equal(hosted["x-tool-approval-mode"], "ask");
    assert.equal(hosted["x-access-mode"], "hosted");
    assert.equal(hosted["x-speed-tier"], "fast");

    const expert = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
      speedTier: "expert",
    });
    assert.equal(expert["x-speed-tier"], "expert");

    const auto = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
      toolApprovalMode: "auto",
    });
    assert.equal(auto["x-tool-approval-mode"], "auto");
  });

  it("hosted resolveModel ignores leftover catalog ids and uses the Fast Cloud route", () => {
    assert.equal(
      resolveModel({
        ...DEFAULT_SETTINGS,
        accessMode: "hosted",
        model: "anthropic/claude-sonnet-5",
        speedTier: "fast",
      }),
      FAST_OPENROUTER_MODEL,
    );
    assert.equal(
      buildChatHeaders({
        ...DEFAULT_SETTINGS,
        accessMode: "hosted",
        model: "anthropic/claude-sonnet-5",
        speedTier: "fast",
      })["x-model"],
      FAST_OPENROUTER_MODEL,
    );
  });
});
