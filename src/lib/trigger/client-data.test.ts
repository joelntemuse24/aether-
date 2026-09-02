import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  persistableChatClientData,
  redactChatClientData,
  resolveByokClientSecrets,
  parseChatClientData,
  buildBrowserChatClientData,
  sessionSafeChatClientData,
} from "./client-data";
import { DEFAULT_SETTINGS } from "../settings";

const hosted = {
  accessMode: "hosted" as const,
  model: "openai/gpt-5",
  toolsEnabled: true,
  approvalMode: "ask" as const,
};

const byok = {
  accessMode: "byok" as const,
  model: "gpt-4o",
  provider: "openai" as const,
  apiKey: "sk-live-secret-do-not-keep",
  baseURL: "https://api.openai.com/v1",
  toolsEnabled: true,
  approvalMode: "auto" as const,
};

describe("chat clientData secrets", () => {
  it("keeps BYOK provider + key + base URL on the ephemeral turn payload", () => {
    const secrets = resolveByokClientSecrets(byok);
    assert.deepEqual(secrets, {
      provider: "openai",
      apiKey: "sk-live-secret-do-not-keep",
      baseURL: "https://api.openai.com/v1",
    });
    assert.equal(resolveByokClientSecrets(hosted), null);
  });

  it("does not persist BYOK keys (or connector tokens) for Neon / snapshots", () => {
    const persisted = persistableChatClientData({
      ...byok,
      contextToken: "jwt-with-drive-material",
      driveAccessToken: "ya29.drive",
      githubAccessToken: "gho_github",
      conversationId: "c1",
    });
    assert.equal("apiKey" in persisted, false);
    assert.equal("contextToken" in persisted, false);
    assert.equal("driveAccessToken" in persisted, false);
    assert.equal("githubAccessToken" in persisted, false);
    assert.equal(persisted.accessMode, "byok");
    assert.equal(persisted.provider, "openai");
    assert.equal(persisted.conversationId, "c1");
    assert.doesNotMatch(JSON.stringify(persisted), /sk-live-secret-do-not-keep/);
    assert.doesNotMatch(JSON.stringify(persisted), /ya29\.drive|gho_github|jwt-with-drive/);
  });

  it("redacts secrets in logs", () => {
    const redacted = redactChatClientData({
      ...byok,
      contextToken: "eyJhbGciOiJIUzI1NiJ9.payload.sig",
    });
    const blob = JSON.stringify(redacted);
    assert.doesNotMatch(blob, /sk-live-secret-do-not-keep/);
    assert.doesNotMatch(blob, /eyJhbGciOiJIUzI1NiJ9/);
    assert.equal(redacted.apiKey, "[redacted]");
    assert.equal(redacted.contextToken, "[redacted]");
    assert.equal(redacted.provider, "openai");
    assert.equal(redacted.model, "gpt-4o");
  });

  it("rejects BYOK clientData without a key and hosted without a model", () => {
    const missingKey = parseChatClientData({
      accessMode: "byok",
      model: "gpt-4o",
      provider: "openai",
    });
    assert.equal(missingKey.ok, false);

    const hostedOk = parseChatClientData({
      accessMode: "hosted",
      model: "openai/gpt-5",
    });
    assert.equal(hostedOk.ok, true);

    const byokOk = parseChatClientData(byok);
    assert.equal(byokOk.ok, true);
    if (byokOk.ok) {
      assert.equal(byokOk.data.apiKey, "sk-live-secret-do-not-keep");
    }
  });

  it("builds per-turn clientData from settings without writing keys to persistable dumps", () => {
    const data = buildBrowserChatClientData({
      settings: {
        ...DEFAULT_SETTINGS,
        accessMode: "byok",
        provider: "openai",
        openaiKey: "sk-live-secret-do-not-keep",
        apiKey: "sk-live-secret-do-not-keep",
        model: "gpt-4o",
      },
      conversationId: "c1",
    });
    assert.equal(data.apiKey, "sk-live-secret-do-not-keep");
    assert.equal("apiKey" in persistableChatClientData(data), false);
  });

  it("keeps the context JWT on the sticky session payload but not the BYOK key", () => {
    const safe = sessionSafeChatClientData({
      ...byok,
      contextToken: "jwt-context",
      conversationId: "c1",
    });
    assert.equal("apiKey" in safe, false);
    assert.equal(safe.contextToken, "jwt-context");
    assert.equal(safe.provider, "openai");
    assert.doesNotMatch(JSON.stringify(safe), /sk-live-secret-do-not-keep/);
  });
});
