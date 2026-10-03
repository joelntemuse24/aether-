import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CONTINUE_USER_TEXT } from "@/lib/chat-continue";
import { conversationIdForTurn } from "@/lib/trigger/thread-remote-id";
import {
  planHostedTurnResume,
  resolveHostedConversationId,
} from "./conversation-continuity";

const RENT_ANSWER =
  "Dublin average rent is about €2,400. CPI (August 2026) and the ECB rate are in the table.";

describe("conversation continuity", () => {
  it("keeps one guest session for a chained follow-up such as now put that in a spreadsheet", () => {
    const first = conversationIdForTurn({
      remoteId: null,
      locationId: null,
      fallbackId: "chat-stable-1",
    });
    const followUp = conversationIdForTurn({
      remoteId: undefined,
      locationId: "  ",
      fallbackId: "chat-stable-1",
    });
    assert.equal(first, "chat-stable-1");
    assert.equal(followUp, first);

    const opened = planHostedTurnResume({
      conversationId: followUp,
      sessionIsNew: true,
      userText: "now put that in a spreadsheet",
      history: [
        { role: "user", content: "Dublin rent vs CPI vs ECB table" },
        { role: "assistant", content: RENT_ANSWER },
        { role: "user", content: "now put that in a spreadsheet" },
      ],
    });
    assert.equal(opened.conversationId, "chat-stable-1");
    assert.equal(resolveHostedConversationId(opened.conversationId), "chat-stable-1");
    assert.equal(opened.replayed, true);
    assert.match(opened.userText, /Dublin average rent is about €2,400/);
    assert.match(opened.userText, /now put that in a spreadsheet/);
  });

  it("keeps a signed-in conversation id instead of minting a guest session", () => {
    assert.equal(resolveHostedConversationId("  user-thread-9  "), "user-thread-9");
    assert.equal(
      conversationIdForTurn({
        remoteId: "user-thread-9",
        fallbackId: "chat-stable-1",
      }),
      "user-thread-9",
    );
    const plan = planHostedTurnResume({
      conversationId: "user-thread-9",
      sessionIsNew: true,
      userText: "now put that in a spreadsheet",
      history: [
        { role: "user", content: "Dublin rent vs CPI vs ECB table" },
        { role: "assistant", content: RENT_ANSWER },
        { role: "user", content: "now put that in a spreadsheet" },
      ],
    });
    assert.equal(plan.conversationId, "user-thread-9");
    assert.match(plan.userText, /€2,400/);
  });

  it("resumes a Continuing retry with the interrupted answer", () => {
    const plan = planHostedTurnResume({
      conversationId: "chat-stable-1",
      sessionIsNew: false,
      userText: CONTINUE_USER_TEXT,
      history: [
        { role: "user", content: "Dublin rent vs CPI vs ECB table" },
        { role: "assistant", content: "Partial rent table before the cut-off." },
        { role: "user", content: CONTINUE_USER_TEXT },
      ],
    });
    assert.equal(plan.conversationId, "chat-stable-1");
    assert.equal(plan.replayed, true);
    assert.match(plan.userText, /Partial rent table before the cut-off/);
    assert.match(plan.userText, /Continue from where you left off/);
  });

  it("sends only the new request when the same session already has the earlier turns", () => {
    const plan = planHostedTurnResume({
      conversationId: "chat-stable-1",
      sessionIsNew: false,
      userText: "now put that in a spreadsheet",
      history: [
        { role: "user", content: "Dublin rent vs CPI vs ECB table" },
        { role: "assistant", content: RENT_ANSWER },
        { role: "user", content: "now put that in a spreadsheet" },
      ],
    });
    assert.equal(plan.replayed, false);
    assert.equal(plan.userText, "now put that in a spreadsheet");
  });

  it("wires guest sends and hosted turns to the stable id and replay", () => {
    const runtime = readFileSync(
      new URL("../../providers/runtime-provider.tsx", import.meta.url),
      "utf8",
    );
    const stream = readFileSync(new URL("./chat-stream.ts", import.meta.url), "utf8");
    const sessions = readFileSync(new URL("./sessions.ts", import.meta.url), "utf8");
    assert.match(runtime, /conversationIdForTurn/);
    assert.match(runtime, /conversationFallbackRef/);
    const prepareAt = runtime.indexOf("prepareSendMessagesRequest:");
    const prepareFn = runtime.slice(prepareAt, runtime.indexOf("buildTurnBodyRef", prepareAt));
    assert.match(prepareFn, /conversationIdForTurn/);
    assert.match(prepareFn, /conversationId: conversationId \?\? remoteId/);
    assert.match(prepareFn, /fallbackId: conversationFallbackRef\.current/);
    assert.match(stream, /planHostedTurnResume/);
    assert.match(stream, /session\.created/);
    assert.doesNotMatch(stream, /guest-\$\{crypto\.randomUUID\(\)\}/);
    assert.match(sessions, /return sessionResult\(row, true\)/);
    assert.match(sessions, /return sessionResult\(existing, false\)/);
  });
});
