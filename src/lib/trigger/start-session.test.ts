import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  persistableChatClientData,
  parseChatClientData,
  sessionSafeChatClientData,
} from "./client-data";
import { mergeStartSessionClientData } from "./start-session";

describe("start-session clientData", () => {
  it("forwards BYOK secrets only on the ephemeral payload, never on persistable", () => {
    const parsed = parseChatClientData({
      accessMode: "byok",
      model: "gpt-4o",
      provider: "openai",
      apiKey: "sk-live-secret-do-not-keep",
      baseURL: "https://api.openai.com/v1",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const merged = mergeStartSessionClientData({
      clientData: parsed.data,
      userId: "user-1",
      conversationId: "c1",
      contextToken: "jwt-context",
      hasDrive: true,
      hasGitHub: false,
      hasMemory: true,
    });
    assert.equal(merged.apiKey, "sk-live-secret-do-not-keep");
    assert.equal(merged.contextToken, "jwt-context");
    assert.equal(merged.userId, "user-1");
    const persisted = persistableChatClientData(merged);
    assert.equal("apiKey" in persisted, false);
    assert.doesNotMatch(JSON.stringify(persisted), /sk-live-secret-do-not-keep/);
    assert.doesNotMatch(JSON.stringify(persisted), /jwt-context/);
    const sessionSafe = sessionSafeChatClientData(merged);
    assert.equal("apiKey" in sessionSafe, false);
    assert.equal(sessionSafe.contextToken, "jwt-context");
    assert.equal(sessionSafe.userId, "user-1");
    assert.doesNotMatch(JSON.stringify(sessionSafe), /sk-live-secret-do-not-keep/);
  });
});
