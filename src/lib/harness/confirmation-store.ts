/**
 * Cloud persistence for pending confirmations (signed-in + DB).
 * Guest / no-DB stays in the in-memory map from confirmation.ts.
 */

import { eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { pendingConfirmations } from "@/lib/db/schema";
import {
  setConfirmationRepository,
  type ConfirmationRepository,
  type PendingConfirmationRow,
} from "./confirmation";
import type { ConfirmationRequest } from "./confirmation";

function fromRow(row: typeof pendingConfirmations.$inferSelect): PendingConfirmationRow {
  return {
    id: row.id,
    request: row.requestJson as ConfirmationRequest,
    userId: row.userId,
    conversationId: row.conversationId,
    runId: row.runId,
    createdAt: row.createdAt.getTime(),
    status: (row.status as PendingConfirmationRow["status"]) || "pending",
    approved:
      row.status === "approved"
        ? true
        : row.status === "declined"
          ? false
          : undefined,
  };
}

export function createDbConfirmationRepository(): ConfirmationRepository {
  return {
    async save(row) {
      if (!isCloudDbConfigured() || !row.userId) return;
      const db = await getDb();
      const now = new Date();
      const createdAt = new Date(row.createdAt);
      await db
        .insert(pendingConfirmations)
        .values({
          id: row.id,
          userId: row.userId,
          conversationId: row.conversationId ?? null,
          runId: row.runId ?? null,
          requestJson: row.request,
          status: row.status,
          createdAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: pendingConfirmations.id,
          set: {
            requestJson: row.request,
            status: row.status,
            conversationId: row.conversationId ?? null,
            runId: row.runId ?? null,
            updatedAt: now,
          },
        });
    },
    async load(id) {
      if (!isCloudDbConfigured()) return null;
      const db = await getDb();
      const rows = await db
        .select()
        .from(pendingConfirmations)
        .where(eq(pendingConfirmations.id, id))
        .limit(1);
      return rows[0] ? fromRow(rows[0]) : null;
    },
  };
}

let attached = false;

/** Attach the DB repository once per process when cloud DB is configured. */
export function ensureConfirmationRepository(): void {
  if (attached) return;
  if (!isCloudDbConfigured()) return;
  attached = true;
  setConfirmationRepository(createDbConfirmationRepository());
}
