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
  const requestedId = input.id?.trim();
  const kind = input.kind;
  const title = input.title.slice(0, 200);
  const language = input.language ?? null;
  const content = input.content.slice(0, 500_000);
  const projectId = input.projectId ?? null;
  const conversationId = input.conversationId ?? null;

  if (requestedId) {
    const owned = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.id, requestedId), eq(artifacts.userId, userId)))
      .limit(1);
    if (owned[0]) {
      await db
        .update(artifacts)
        .set({
          kind,
          title,
          language,
          content,
          projectId,
          conversationId,
          updatedAt: now,
        })
        .where(
          and(eq(artifacts.id, requestedId), eq(artifacts.userId, userId)),
        );
      const rows = await db
        .select()
        .from(artifacts)
        .where(
          and(eq(artifacts.id, requestedId), eq(artifacts.userId, userId)),
        )
        .limit(1);
      return toDto(rows[0]!);
    }
    const taken = await db
      .select({ id: artifacts.id })
      .from(artifacts)
      .where(eq(artifacts.id, requestedId))
      .limit(1);
    if (taken[0]) {
      throw new Error("Artifact id belongs to another user");
    }
  }

  const id = requestedId || crypto.randomUUID();
  await db.insert(artifacts).values({
    id,
    userId,
    kind,
    title,
    language,
    content,
    projectId,
    conversationId,
    createdAt: now,
    updatedAt: now,
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
