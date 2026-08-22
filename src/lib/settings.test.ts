import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, buildChatHeaders } from "./settings";

describe("buildChatHeaders", () => {
  it("sends Ask by default and Auto when chosen", () => {
    const hosted = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
    });
    assert.equal(hosted["x-tool-approval-mode"], "ask");
    assert.equal(hosted["x-access-mode"], "hosted");

    const auto = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
      toolApprovalMode: "auto",
    });
    assert.equal(auto["x-tool-approval-mode"], "auto");
  });
});
