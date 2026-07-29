import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { memoryRecords, MEMORY_TYPES } from "@/lib/db/schema";
import { formatMemoryForPrompt } from "./format";
import type { MemoryDTO, MemoryType } from "./types";

export type { MemoryDTO, MemoryType };
export { formatMemoryForPrompt };

function toDto(row: typeof memoryRecords.$inferSelect): MemoryDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    importance: row.importance,
    tags: Array.isArray(row.tags) ? row.tags : [],
    updatedAt: row.updatedAt?.toISOString?.(),
  };
}

export async function listMemories(userId: string): Promise<MemoryDTO[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(eq(memoryRecords.userId, userId))
    .orderBy(desc(memoryRecords.updatedAt))
    .limit(200);
  return rows.map(toDto);
}

export async function searchMemories(
  userId: string,
  query: string,
  limit = 8,
): Promise<MemoryDTO[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const q = query.trim();
  if (!q) {
    const rows = await db
      .select()
      .from(memoryRecords)
      .where(eq(memoryRecords.userId, userId))
      .orderBy(desc(memoryRecords.updatedAt))
      .limit(limit);
    return rows.map(toDto);
  }
  const pattern = `%${q.replace(/[%_]/g, "")}%`;
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(
      and(
        eq(memoryRecords.userId, userId),
        or(
          ilike(memoryRecords.title, pattern),
          ilike(memoryRecords.body, pattern),
          ilike(memoryRecords.type, pattern),
        ),
      ),
    )
    .orderBy(desc(memoryRecords.updatedAt))
    .limit(limit);
  return rows.map(toDto);
}

export async function writeMemory(
  userId: string,
  input: {
    id?: string;
    type?: string;
    title: string;
    body: string;
    importance?: string;
    tags?: string[];
  },
): Promise<MemoryDTO> {
  const db = await getDb();
  const now = new Date();
  const requestedId = input.id?.trim();
  const type =
    input.type && (MEMORY_TYPES as readonly string[]).includes(input.type)
      ? input.type
      : "note";
  const title = input.title.slice(0, 200);
  const body = input.body.slice(0, 8000);
  const importance = input.importance || "normal";
  const tags = (input.tags ?? []).slice(0, 12);

  if (requestedId) {
    const owned = await db
      .select()
      .from(memoryRecords)
      .where(
        and(eq(memoryRecords.id, requestedId), eq(memoryRecords.userId, userId)),
      )
      .limit(1);
    if (owned[0]) {
      await db
        .update(memoryRecords)
        .set({ type, title, body, importance, tags, updatedAt: now })
        .where(
          and(
            eq(memoryRecords.id, requestedId),
            eq(memoryRecords.userId, userId),
          ),
        );
      const rows = await db
        .select()
        .from(memoryRecords)
        .where(
          and(
            eq(memoryRecords.id, requestedId),
            eq(memoryRecords.userId, userId),
          ),
        )
        .limit(1);
      return toDto(rows[0]!);
    }
    const taken = await db
      .select({ id: memoryRecords.id })
      .from(memoryRecords)
      .where(eq(memoryRecords.id, requestedId))
      .limit(1);
    if (taken[0]) {
      throw new Error("Memory id belongs to another user");
    }
  }

  const id = requestedId || crypto.randomUUID();
  await db.insert(memoryRecords).values({
    id,
    userId,
    type,
    title,
    body,
    importance,
    tags,
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(memoryRecords)
    .where(and(eq(memoryRecords.id, id), eq(memoryRecords.userId, userId)))
    .limit(1);
  return toDto(rows[0]!);
}

export async function deleteMemory(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(memoryRecords)
    .where(and(eq(memoryRecords.id, id), eq(memoryRecords.userId, userId)));
  return true;
}

export async function relevantMemoryPrompt(
  userId: string,
  query: string,
): Promise<string> {
  try {
    const hits = await searchMemories(userId, query, 8);
    if (hits.length === 0) {
      const recent = await listMemories(userId);
      return formatMemoryForPrompt(recent.slice(0, 6));
    }
    return formatMemoryForPrompt(hits);
  } catch {
    return "";
  }
}
