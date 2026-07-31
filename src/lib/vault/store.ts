import { and, desc, eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { vaultNotes } from "@/lib/db/schema";
import type { VaultNoteDTO } from "./types";

export type { VaultNoteDTO };

function toDto(row: typeof vaultNotes.$inferSelect): VaultNoteDTO {
  const updated =
    row.updatedAt instanceof Date ? row.updatedAt.getTime() : Date.now();
  return {
    id: row.id,
    title: row.title,
    content: row.content ?? "",
    updatedAt: updated,
  };
}

export async function listVaultNotes(userId: string): Promise<VaultNoteDTO[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(vaultNotes)
    .where(eq(vaultNotes.userId, userId))
    .orderBy(desc(vaultNotes.updatedAt))
    .limit(200);
  return rows.map(toDto);
}

export async function createVaultNote(
  userId: string,
  input: { id?: string; title: string; content?: string },
): Promise<VaultNoteDTO> {
  const db = await getDb();
  const now = new Date();
  const id = input.id || crypto.randomUUID();
  await db.insert(vaultNotes).values({
    id,
    userId,
    title: input.title.slice(0, 120) || "Untitled note",
    content: (input.content ?? "").slice(0, 100_000),
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(vaultNotes)
    .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)))
    .limit(1);
  return toDto(rows[0]!);
}

export async function updateVaultNote(
  userId: string,
  id: string,
  patch: { title?: string; content?: string },
): Promise<VaultNoteDTO | null> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(vaultNotes)
    .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)))
    .limit(1);
  if (!existing[0]) return null;
  await db
    .update(vaultNotes)
    .set({
      ...(patch.title !== undefined
        ? { title: patch.title.slice(0, 120) || "Untitled note" }
        : {}),
      ...(patch.content !== undefined
        ? { content: patch.content.slice(0, 100_000) }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)));
  const rows = await db
    .select()
    .from(vaultNotes)
    .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function upsertVaultNote(
  userId: string,
  input: { id?: string; title: string; content: string },
): Promise<VaultNoteDTO> {
  if (input.id) {
    const updated = await updateVaultNote(userId, input.id, {
      title: input.title,
      content: input.content,
    });
    if (updated) return updated;
  }
  return createVaultNote(userId, input);
}

export async function deleteVaultNote(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(vaultNotes)
    .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)));
  return true;
}

export async function getVaultNote(
  userId: string,
  id: string,
): Promise<VaultNoteDTO | null> {
  if (!isCloudDbConfigured()) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(vaultNotes)
    .where(and(eq(vaultNotes.id, id), eq(vaultNotes.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}
