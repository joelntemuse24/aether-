import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStartSessionRequest,
  parseMintedAccessToken,
  parseStartSessionResult,
} from "./session-auth";
import {
  bindDurableChatId,
  resetDurableChatIdBindings,
  resolveInitializedRemoteId,
} from "./thread-remote-id";

describe("durable session chatId", () => {
  it("keeps the transport chatId as the Trigger session externalId even when a thread remoteId exists", () => {
    const transportChatId = "usechat-uuid-aaaa";
    const threadRemoteId = "thread-uuid-bbbb";
    const body = buildStartSessionRequest({
      transportChatId,
      threadRemoteId,
      clientData: {
        accessMode: "hosted",
        model: "anthropic/claude-sonnet-5",
        conversationId: threadRemoteId,
      },
    });
    assert.equal(body.chatId, transportChatId);
    assert.notEqual(body.chatId, threadRemoteId);
    assert.equal(body.clientData.conversationId, threadRemoteId);
    assert.equal(body.clientData.accessMode, "hosted");
    assert.equal(body.clientData.model, "anthropic/claude-sonnet-5");
  });

  it("falls back conversationId to the transport chatId when the thread is not initialized yet", () => {
    const body = buildStartSessionRequest({
      transportChatId: "  guest-chat-1  ",
      clientData: { accessMode: "hosted", model: "anthropic/claude-sonnet-5" },
    });
    assert.equal(body.chatId, "guest-chat-1");
    assert.equal(body.clientData.conversationId, "guest-chat-1");
  });

  it("rejects an empty transport chatId", () => {
    assert.throws(
      () =>
        buildStartSessionRequest({
          transportChatId: "   ",
          clientData: { accessMode: "hosted", model: "x" },
        }),
      /chatId is required/,
    );
  });
});

describe("minted access token parsing", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlbnYiLCJzY29wZXMiOlsicmVhZDpzZXNzaW9uczpjMSIsIndyaXRlOnNlc3Npb25zOmMxIl19.sig";

  it("returns a raw JWT from text/plain mint-token", () => {
    assert.equal(parseMintedAccessToken(jwt), jwt);
  });

  it("unwraps JSON { publicAccessToken } so a 403 refresh still gets a PAT", () => {
    assert.equal(
      parseMintedAccessToken(JSON.stringify({ publicAccessToken: jwt, sessionId: "session_x" })),
      jwt,
    );
  });

  it("rejects an object-stringified token that would 403 as Bearer [object Object]", () => {
    assert.throws(() => parseMintedAccessToken("[object Object]"), /Could not start chat/);
    assert.throws(() => parseMintedAccessToken(""), /Could not start chat/);
    assert.throws(
      () => parseMintedAccessToken(JSON.stringify({ ok: true })),
      /Could not start chat/,
    );
  });
});

describe("start-session result parsing", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlbnYiLCJzY29wZXMiOlsicmVhZDpzZXNzaW9uczpjMSJdfQ.sig";

  it("reads publicAccessToken from the createStartSessionAction object", () => {
    const parsed = parseStartSessionResult({
      publicAccessToken: jwt,
      runId: "run_1",
      sessionId: "session_1",
    });
    assert.equal(parsed.publicAccessToken, jwt);
  });

  it("wraps a bare JWT string as { publicAccessToken }", () => {
    assert.equal(parseStartSessionResult(jwt).publicAccessToken, jwt);
  });

  it("rejects a missing PAT so the transport never sends Bearer undefined", () => {
    assert.throws(
      () => parseStartSessionResult({ runId: "run_1", sessionId: "session_1" }),
      /Could not start chat/,
    );
  });
});

describe("new-thread remoteId alignment", () => {
  it("reuses the durable useChat id instead of minting a second UUID for __LOCALID_ threads", () => {
    resetDurableChatIdBindings();
    bindDurableChatId("durable-usechat-id", "__LOCALID_abc");
    assert.equal(
      resolveInitializedRemoteId("__LOCALID_abc"),
      "durable-usechat-id",
    );
  });

  it("keeps an already-public thread id unchanged", () => {
    resetDurableChatIdBindings();
    assert.equal(
      resolveInitializedRemoteId("5cb32a2d-c3d5-49f1-b1a9-6f7bb97b466f"),
      "5cb32a2d-c3d5-49f1-b1a9-6f7bb97b466f",
    );
  });

  it("does not alias an unbound __LOCALID_ thread onto another chat's durable id", () => {
    resetDurableChatIdBindings();
    bindDurableChatId("durable-thread-a", "__LOCALID_a");
    const b = resolveInitializedRemoteId("__LOCALID_b");
    assert.notEqual(b, "durable-thread-a");
    assert.notEqual(b, "__LOCALID_b");
    assert.equal(resolveInitializedRemoteId("__LOCALID_a"), "durable-thread-a");
  });
});
