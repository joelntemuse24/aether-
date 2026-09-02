import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { sessionSafeChatClientData } from "./client-data";
import {
  DURABLE_HEAD_START_PATH,
  HEAD_START_MAX_DURATION_SECONDS,
  applyHeadStartWireMetadata,
  splitHeadStartClientData,
} from "./head-start";

describe("head start first-turn contract", () => {
  it("posts the first durable turn to the warm head-start route", () => {
    assert.equal(DURABLE_HEAD_START_PATH, "/api/chat/head-start");
  });

  it("keeps first-turn SSE under a short function budget, not the 300s loop cap", () => {
    assert.ok(HEAD_START_MAX_DURATION_SECONDS <= 120);
    assert.ok(HEAD_START_MAX_DURATION_SECONDS >= 30);
    assert.notEqual(HEAD_START_MAX_DURATION_SECONDS, 300);
  });

  it("strips BYOK keys from the session metadata while keeping them on the warm turn", () => {
    const { turnClientData, sessionMetadata } = splitHeadStartClientData({
      accessMode: "byok",
      model: "gpt-4o",
      provider: "openai",
      apiKey: "sk-live-secret-do-not-keep",
      conversationId: "c1",
      contextToken: "jwt-context",
    });
    assert.equal(turnClientData.apiKey, "sk-live-secret-do-not-keep");
    assert.equal("apiKey" in sessionMetadata, false);
    assert.equal(sessionMetadata.contextToken, "jwt-context");
    assert.deepEqual(sessionMetadata, sessionSafeChatClientData(turnClientData));
    assert.doesNotMatch(
      JSON.stringify(sessionMetadata),
      /sk-live-secret-do-not-keep/,
    );
  });

  it("rewrites the head-start wire payload metadata to the session-safe object", () => {
    const { sessionMetadata } = splitHeadStartClientData({
      accessMode: "byok",
      model: "gpt-4o",
      provider: "openai",
      apiKey: "sk-live-secret-do-not-keep",
    });
    const next = applyHeadStartWireMetadata(
      {
        chatId: "chat-1",
        trigger: "submit-message",
        headStartMessages: [{ id: "u1", role: "user", parts: [] }],
        metadata: { accessMode: "byok", apiKey: "sk-live-secret-do-not-keep" },
      },
      sessionMetadata,
    );
    assert.equal(next.chatId, "chat-1");
    assert.equal((next.metadata as { accessMode?: string }).accessMode, "byok");
    assert.doesNotMatch(JSON.stringify(next), /sk-live-secret-do-not-keep/);
  });
});

describe("head start route bundle isolation", () => {
  it("uses chat.headStart with schema-only tools and does not import the full loop", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/head-start/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /chat\.headStart/);
    assert.match(route, /@trigger\.dev\/sdk\/chat-server/);
    assert.match(route, /buildHeadStartToolSchemas/);
    assert.match(route, /HEAD_START_MAX_DURATION_SECONDS/);
    assert.match(route, /sessionSafeChatClientData|splitHeadStartClientData/);
    assert.doesNotMatch(route, /runLegacyLocalChat/);
    assert.doesNotMatch(route, /from ["']@\/lib\/harness\/tool-registry["']/);
    assert.doesNotMatch(route, /maxDuration\s*=\s*300/);
    assert.doesNotMatch(route, /preload\(/);
  });

  it("fails closed with 503 when durable chat env is missing", () => {
    const route = readFileSync(
      new URL("../../app/api/chat/head-start/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(route, /isTriggerChatConfigured/);
    assert.match(route, /status: 503/);
    assert.match(route, /chatId is required/);
  });
});
