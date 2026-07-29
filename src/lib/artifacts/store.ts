import { and, desc, eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { artifacts } from "@/lib/db/schema";

export type ArtifactDTO = {
  id: string;
  kind: string;
  title: string;
  language?: string;
  content: string;
  projectId?: string;
  conversationId?: string;
  updatedAt?: string;
};

function toDto(row: typeof artifacts.$inferSelect): ArtifactDTO {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    language: row.language ?? undefined,
    content: row.content,
    projectId: row.projectId ?? undefined,
    conversationId: row.conversationId ?? undefined,
    updatedAt: row.updatedAt?.toISOString?.(),
  };
}

export async function saveArtifact(
  userId: string,
  input: {
    id?: string;
    kind: string;
    title: string;
    language?: string;
    content: string;
    projectId?: string;
    conversationId?: string;
  },
): Promise<ArtifactDTO> {
  const db = await getDb();
  const now = new Date();
  const id = input.id || crypto.randomUUID();
  await db
    .insert(artifacts)
    .values({
      id,
      userId,
      kind: input.kind,
      title: input.title.slice(0, 200),
      language: input.language ?? null,
      content: input.content.slice(0, 500_000),
      projectId: input.projectId ?? null,
      conversationId: input.conversationId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: artifacts.id,
      set: {
        kind: input.kind,
        title: input.title.slice(0, 200),
        language: input.language ?? null,
        content: input.content.slice(0, 500_000),
        projectId: input.projectId ?? null,
        conversationId: input.conversationId ?? null,
        updatedAt: now,
      },
    });
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, userId)))
    .limit(1);
  return toDto(rows[0]!);
}

export async function listArtifacts(
  userId: string,
  limit = 30,
): Promise<ArtifactDTO[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.userId, userId))
    .orderBy(desc(artifacts.updatedAt))
    .limit(limit);
  return rows.map(toDto);
}

export async function getArtifact(
  userId: string,
  id: string,
): Promise<ArtifactDTO | null> {
  if (!isCloudDbConfigured()) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function deleteArtifact(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(artifacts)
    .where(and(eq(artifacts.id, id), eq(artifacts.userId, userId)));
  return true;
}
