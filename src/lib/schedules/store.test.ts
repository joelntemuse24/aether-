import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryScheduleStore } from "./store";

describe("schedule store (memory)", () => {
  it("creates, lists, and cancels jobs for one user", async () => {
    const store = createMemoryScheduleStore();
    const created = await store.create({
      userId: "u1",
      title: "Morning brief",
      prompt: "Brief me",
      cron: "0 8 * * *",
      timezone: "UTC",
      delivery: "email",
    });
    assert.equal(created.status, "active");
    const listed = await store.list("u1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.id);
    assert.equal((await store.list("u2")).length, 0);
    const cancelled = await store.cancel("u1", created.id);
    assert.equal(cancelled?.status, "cancelled");
  });

  it("rejects an empty prompt", async () => {
    const store = createMemoryScheduleStore();
    await assert.rejects(
      () =>
        store.create({
          userId: "u1",
          title: "Empty",
          prompt: "  ",
          cron: "0 8 * * *",
          timezone: "UTC",
          delivery: "inbox",
        }),
      /prompt/i,
    );
  });
});
