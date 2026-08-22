import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createConfirmationRequest,
  peekConfirmation,
  resolveConfirmation,
  setConfirmationRepository,
  type ConfirmationRepository,
  type PendingConfirmationRow,
} from "./confirmation";

function memoryRepo(): ConfirmationRepository & {
  rows: Map<string, PendingConfirmationRow>;
} {
  const rows = new Map<string, PendingConfirmationRow>();
  return {
    rows,
    async save(row) {
      rows.set(row.id, { ...row });
    },
    async load(id) {
      return rows.get(id) ?? null;
    },
    async remove(id) {
      rows.delete(id);
    },
  };
}

describe("confirmation persist", () => {
  it("keeps pending cards in the repository for signed-in users", async () => {
    const repo = memoryRepo();
    setConfirmationRepository(repo);
    try {
      const created = await createConfirmationRequest(
        {
          action: "delete_resource",
          title: "Delete note",
          preview: "Remove the saved note permanently.",
        },
        "user-1",
      );
      assert.equal(created.needs_confirmation, true);
      assert.ok(repo.rows.has(created.confirmation_id));
      const peeked = await peekConfirmation(created.confirmation_id);
      assert.ok(peeked);
      assert.equal(peeked?.request.title, "Delete note");
      assert.equal(peeked?.userId, "user-1");
    } finally {
      setConfirmationRepository(null);
    }
  });

  it("resolves from the repository after memory is cleared (refresh)", async () => {
    const repo = memoryRepo();
    setConfirmationRepository(repo);
    try {
      const created = await createConfirmationRequest(
        {
          action: "submit_form",
          title: "Submit application",
          preview: "Send the form to the portal.",
          payload: { tool: "memory_write", args: { title: "x", body: "y" } },
        },
        "user-1",
      );
      // Simulate a new serverless isolate: in-memory map is empty, DB still has it.
      const isolated = await import("./confirmation");
      // Force-clear in-memory by resolving against repo only — drop memory via peek after delete from map.
      const id = created.confirmation_id;
      const before = repo.rows.get(id);
      assert.ok(before);
      // Wipe in-process memory by resolving through a helper that only has repo.
      const { forgetMemoryConfirmation } = isolated;
      forgetMemoryConfirmation(id);
      assert.equal((await isolated.peekConfirmation(id))?.request.title, "Submit application");

      const resolved = await isolated.resolveConfirmation(id, true, "user-1");
      assert.equal(resolved.ok, true);
      if (resolved.ok) {
        assert.equal(resolved.approved, true);
        assert.equal(resolved.needs_confirmation, false);
      }
      const after = await isolated.peekConfirmation(id);
      assert.equal(after?.status, "approved");
    } finally {
      setConfirmationRepository(null);
    }
  });

  it("rejects another user's confirmation", async () => {
    const repo = memoryRepo();
    setConfirmationRepository(repo);
    try {
      const created = await createConfirmationRequest(
        {
          action: "other_side_effect",
          title: "Act",
          preview: "Do the thing.",
        },
        "owner",
      );
      const result = await resolveConfirmation(created.confirmation_id, true, "intruder");
      assert.equal(result.ok, false);
    } finally {
      setConfirmationRepository(null);
    }
  });
});
