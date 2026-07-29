import { and, desc, eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import {
  formatProjectForPrompt,
  type ProjectDTO,
} from "./types";

export type { ProjectDTO };
export { formatProjectForPrompt };

function toDto(row: typeof projects.$inferSelect): ProjectDTO {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions ?? undefined,
    pinnedFileIds: Array.isArray(row.pinnedFileIds) ? row.pinnedFileIds : [],
    updatedAt: row.updatedAt?.toISOString?.(),
  };
}

export async function listProjects(userId: string): Promise<ProjectDTO[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt))
    .limit(50);
  return rows.map(toDto);
}

export async function createProject(
  userId: string,
  input: { id?: string; title: string; instructions?: string },
): Promise<ProjectDTO> {
  const db = await getDb();
  const now = new Date();
  const id = input.id || crypto.randomUUID();
  await db.insert(projects).values({
    id,
    userId,
    title: input.title.slice(0, 120),
    instructions: input.instructions?.slice(0, 4000) ?? null,
    pinnedFileIds: [],
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return toDto(rows[0]!);
}

export async function updateProject(
  userId: string,
  id: string,
  patch: { title?: string; instructions?: string | null },
): Promise<ProjectDTO | null> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  if (!existing[0]) return null;
  await db
    .update(projects)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.slice(0, 120) } : {}),
      ...(patch.instructions !== undefined
        ? { instructions: patch.instructions }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function deleteProject(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return true;
}

export async function getProject(
  userId: string,
  id: string,
): Promise<ProjectDTO | null> {
  if (!isCloudDbConfigured()) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

