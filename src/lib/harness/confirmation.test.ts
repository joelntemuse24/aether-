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

  it("parses a client replay payload when the in-memory row is gone", async () => {
    const { confirmationReplayPayload } = await import("./confirmation");
    const parsed = confirmationReplayPayload({
      tool: "create_artifact",
      args: { title: "Demo", content: "Hi" },
      projectId: "p1",
    });
    assert.deepEqual(parsed, {
      tool: "create_artifact",
      args: { title: "Demo", content: "Hi" },
      projectId: "p1",
    });
    assert.equal(confirmationReplayPayload({}), null);
  });

  it("rejects another user's confirmation, including after resolution", async () => {
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
      const pendingResult = await resolveConfirmation(
        created.confirmation_id,
        true,
        "intruder",
      );
      assert.equal(pendingResult.ok, false);

      const ownerResult = await resolveConfirmation(
        created.confirmation_id,
        true,
        "owner",
      );
      assert.equal(ownerResult.ok, true);
      const resolvedResult = await resolveConfirmation(
        created.confirmation_id,
        true,
        "intruder",
      );
      assert.equal(resolvedResult.ok, false);
    } finally {
      setConfirmationRepository(null);
    }
  });

  it("rejects unauthenticated resolution of an owned confirmation", async () => {
    const created = await createConfirmationRequest(
      {
        action: "other_side_effect",
        title: "Act",
        preview: "Do the thing.",
      },
      "owner",
    );
    const result = await resolveConfirmation(created.confirmation_id, true, null);
    assert.equal(result.ok, false);
  });
});

describe("confirmation replay signing", () => {
  it("signs replay payloads and binds them to the confirmation and user", async () => {
    const { verifyConfirmationReplaySignature } = await import("./confirmation");
    const created = await createConfirmationRequest(
      {
        action: "other_side_effect",
        title: "Save memory",
        preview: "Save it.",
        payload: { tool: "memory_write", args: { title: "x", body: "y" } },
      },
      "user-1",
    );
    const payload = created.payload as Record<string, unknown>;
    assert.equal(typeof payload.sig, "string");
    assert.equal(
      verifyConfirmationReplaySignature({
        confirmationId: created.confirmation_id,
        payload,
        userId: "user-1",
      }),
      true,
    );
    assert.equal(
      verifyConfirmationReplaySignature({
        confirmationId: created.confirmation_id,
        payload,
        userId: "intruder",
      }),
      false,
    );
  });

  it("rejects unsigned and tampered replay payloads", async () => {
    const { verifyConfirmationReplaySignature } = await import("./confirmation");
    assert.equal(
      verifyConfirmationReplaySignature({
        confirmationId: "made-up",
        payload: { tool: "memory_write", args: { title: "x", body: "y" } },
        userId: "user-1",
      }),
      false,
    );

    const created = await createConfirmationRequest(
      {
        action: "other_side_effect",
        title: "Save memory",
        preview: "Save it.",
        payload: { tool: "memory_write", args: { title: "x", body: "y" } },
      },
      "user-1",
    );
    const tampered = {
      ...(created.payload as Record<string, unknown>),
      args: { title: "changed", body: "changed" },
    };
    assert.equal(
      verifyConfirmationReplaySignature({
        confirmationId: created.confirmation_id,
        payload: tampered,
        userId: "user-1",
      }),
      false,
    );
  });
});
