import { and, eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { projectKnowledge } from "@/lib/db/schema";
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  chunkText,
  extractKnowledgeText,
  isAllowedKnowledgeFile,
  searchKnowledgeChunks,
  type KnowledgeSearchHit,
} from "./knowledge";

export type ProjectKnowledgeFileDTO = {
  id: string;
  filename: string;
  mime?: string;
  text: string;
  createdAt?: string;
};

export async function listProjectKnowledge(
  userId: string,
  projectId: string,
): Promise<ProjectKnowledgeFileDTO[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.userId, userId),
        eq(projectKnowledge.projectId, projectId),
      ),
    );
  return rows.map(toDto);
}

export async function addProjectKnowledgeFile(
  userId: string,
  projectId: string,
  input: { filename: string; mime?: string; data: ArrayBuffer | Uint8Array },
): Promise<ProjectKnowledgeFileDTO> {
  if (!isAllowedKnowledgeFile(input.filename, input.mime)) {
    throw new Error("Use a PDF, Word, Markdown, text, or CSV file.");
  }
  const bytes =
    input.data instanceof Uint8Array
      ? input.data
      : new Uint8Array(input.data);
  if (bytes.byteLength > MAX_KNOWLEDGE_FILE_BYTES) {
    throw new Error("File is too large (2 MB max).");
  }
  const text = (await extractKnowledgeText(bytes, input.filename, input.mime || "")).slice(
    0,
    200_000,
  );
  if (!text.trim()) {
    throw new Error("Could not read text from that file.");
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(projectKnowledge).values({
    id,
    userId,
    projectId,
    filename: input.filename.slice(0, 200),
    mime: input.mime ?? null,
    text,
    chunks: chunkText(text),
    createdAt: now,
  });
  const rows = await db
    .select()
    .from(projectKnowledge)
    .where(and(eq(projectKnowledge.id, id), eq(projectKnowledge.userId, userId)))
    .limit(1);
  return toDto(rows[0]!);
}

export async function deleteProjectKnowledgeFile(
  userId: string,
  projectId: string,
  fileId: string,
): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.id, fileId),
        eq(projectKnowledge.userId, userId),
        eq(projectKnowledge.projectId, projectId),
      ),
    );
  return true;
}

export async function searchProjectKnowledge(
  userId: string,
  projectId: string,
  query: string,
  limit = 6,
): Promise<KnowledgeSearchHit[]> {
  if (!isCloudDbConfigured()) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(projectKnowledge)
    .where(
      and(
        eq(projectKnowledge.userId, userId),
        eq(projectKnowledge.projectId, projectId),
      ),
    );
  const chunks = rows.flatMap((row) => {
    const stored = Array.isArray(row.chunks) ? row.chunks : [];
    const parts = stored.length > 0 ? stored : chunkText(row.text);
    return parts.map((c) => ({
      fileId: row.id,
      filename: row.filename,
      text: c.text,
    }));
  });
  return searchKnowledgeChunks(chunks, query, limit);
}

function toDto(row: typeof projectKnowledge.$inferSelect): ProjectKnowledgeFileDTO {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime ?? undefined,
    text: row.text,
    createdAt: row.createdAt?.toISOString?.(),
  };
}
