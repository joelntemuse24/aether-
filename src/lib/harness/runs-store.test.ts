import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyAgentRunUpdate, type RunUpdateDb } from "./runs-store";

function fakeDb(matchedRows: Array<{ id: string }>) {
  const inserts: unknown[] = [];
  const db = {
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => matchedRows }),
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => {
        inserts.push(row);
      },
    }),
  };
  return { db: db as unknown as RunUpdateDb, inserts };
}

const input = {
  id: "run-1",
  userId: "user-1",
  status: "acting" as const,
  eventType: "chat_started",
  eventPayload: { surface: "chat" },
};

describe("applyAgentRunUpdate", () => {
  it("skips the event insert when no run matches the id and user", async () => {
    const { db, inserts } = fakeDb([]);
    assert.equal(await applyAgentRunUpdate(db, input), false);
    assert.equal(inserts.length, 0);
  });

  it("inserts the event when the run matches", async () => {
    const { db, inserts } = fakeDb([{ id: "run-1" }]);
    assert.equal(await applyAgentRunUpdate(db, input), true);
    assert.equal(inserts.length, 1);
    assert.equal((inserts[0] as { runId: string }).runId, "run-1");
  });

  it("returns true without an event when none is requested", async () => {
    const { db, inserts } = fakeDb([{ id: "run-1" }]);
    assert.equal(
      await applyAgentRunUpdate(db, { ...input, eventType: undefined }),
      true,
    );
    assert.equal(inserts.length, 0);
  });
});
