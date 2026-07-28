import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  conversationMessages,
  conversations,
  type ConversationRow,
} from "@/lib/db/schema";

export type FormatRepo = {
  headId?: string | null;
  entries: Array<{
    id: string;
    parent_id: string | null;
    format: string;
    content: Record<string, unknown>;
  }>;
};

export type ConversationDTO = {
  remoteId: string;
  title?: string;
  status: "regular" | "archived";
  externalId?: string;
  custom?: Record<string, unknown>;
  updatedAt?: string;
};

function toDto(row: ConversationRow): ConversationDTO {
  return {
    remoteId: row.id,
    title: row.title ?? undefined,
    status: row.status === "archived" ? "archived" : "regular",
    custom: (row.custom as Record<string, unknown> | null) ?? undefined,
    updatedAt: row.updatedAt?.toISOString?.() ?? undefined,
  };
}

export async function listConversations(
  userId: string,
): Promise<ConversationDTO[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt));
  return rows.map(toDto);
}

export async function getConversation(
  userId: string,
  id: string,
): Promise<ConversationDTO | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function createConversation(
  userId: string,
  input: {
    id: string;
    title?: string;
    status?: "regular" | "archived";
    custom?: Record<string, unknown>;
  },
): Promise<ConversationDTO> {
  const db = await getDb();
  const now = new Date();
  await db
    .insert(conversations)
    .values({
      id: input.id,
      userId,
      title: input.title ?? null,
      status: input.status ?? "regular",
      custom: input.custom ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const existing = await getConversation(userId, input.id);
  if (!existing) {
    // Conflict owned by someone else or insert failed
    throw new Error("Could not create conversation");
  }
  return existing;
}

export async function updateConversation(
  userId: string,
  id: string,
  patch: {
    title?: string;
    status?: "regular" | "archived";
    custom?: Record<string, unknown> | null;
  },
): Promise<ConversationDTO | null> {
  const db = await getDb();
  const owned = await getConversation(userId, id);
  if (!owned) return null;

  await db
    .update(conversations)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.custom !== undefined ? { custom: patch.custom } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));

  return getConversation(userId, id);
}

export async function deleteConversation(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  const owned = await getConversation(userId, id);
  if (!owned) return false;
  await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  return true;
}

export async function getMessageRepo(
  userId: string,
  conversationId: string,
): Promise<FormatRepo> {
  const owned = await getConversation(userId, conversationId);
  if (!owned) return { entries: [] };

  const db = await getDb();
  const rows = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .limit(1);

  const repo = rows[0]?.repo;
  if (!repo || !Array.isArray(repo.entries)) return { entries: [] };
  return {
    headId: repo.headId ?? null,
    entries: repo.entries,
  };
}

export async function saveMessageRepo(
  userId: string,
  conversationId: string,
  repo: FormatRepo,
): Promise<void> {
  const owned = await getConversation(userId, conversationId);
  if (!owned) {
    // Auto-create shell conversation if history arrives first
    await createConversation(userId, { id: conversationId });
  }

  const db = await getDb();
  const now = new Date();
  await db
    .insert(conversationMessages)
    .values({
      conversationId,
      repo,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: conversationMessages.conversationId,
      set: { repo, updatedAt: now },
    });

  await db
    .update(conversations)
    .set({ updatedAt: now })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.userId, userId),
      ),
    );
}

export async function migrateConversations(
  userId: string,
  items: Array<{
    id: string;
    title?: string;
    status?: "regular" | "archived";
    custom?: Record<string, unknown>;
    repo?: FormatRepo;
  }>,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const item of items) {
    if (!item.id) {
      skipped += 1;
      continue;
    }
    const existing = await getConversation(userId, item.id);
    if (existing) {
      skipped += 1;
      continue;
    }
    await createConversation(userId, {
      id: item.id,
      title: item.title,
      status: item.status,
      custom: item.custom,
    });
    if (item.repo && item.repo.entries?.length) {
      await saveMessageRepo(userId, item.id, item.repo);
    }
    imported += 1;
  }

  return { imported, skipped };
}
