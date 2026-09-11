import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runScheduledAutomation } from "./runner";
import type { ScheduledJob } from "./types";

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: "job-1",
    userId: "user-1",
    title: "Morning brief",
    prompt: "Summarize overnight notes.",
    cron: "0 8 * * *",
    timezone: "UTC",
    delivery: "email",
    status: "active",
    conversationId: "c1",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...over,
  };
}

describe("scheduled automation runner", () => {
  it("prepares an email draft and does not send", async () => {
    let sent = false;
    const result = await runScheduledAutomation(job(), {
      sendEmail: async () => {
        sent = true;
        return { ok: true };
      },
    });
    assert.equal(sent, false);
    assert.equal(result.ok, true);
    assert.equal(result.sent, false);
    assert.equal(result.needs_confirmation, true);
    assert.match(String(result.preview), /Morning brief|overnight/i);
    assert.doesNotMatch(JSON.stringify(result), /Trigger|Resend|OpenRouter/i);
  });

  it("does not post an inbox delivery without a confirm card", async () => {
    const result = await runScheduledAutomation(job({ delivery: "inbox" }));
    assert.equal(result.sent, false);
    assert.equal(result.needs_confirmation, true);
    assert.equal(result.action, "other_side_effect");
  });

  it("still will not send when Trigger is missing — it stays honest", async () => {
    const result = await runScheduledAutomation(job(), {
      triggerConfigured: false,
    });
    assert.equal(result.sent, false);
    assert.equal(result.needs_confirmation, true);
  });
});
