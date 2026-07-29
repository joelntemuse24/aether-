/**
 * Browser-local memory when cloud DB is unavailable.
 * Key: aether:memory:v1
 */

import type { MemoryDTO } from "./types";
import { formatMemoryForPrompt } from "./format";

const KEY = "aether:memory:v1";

export function loadLocalMemories(): MemoryDTO[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is MemoryDTO =>
        !!m &&
        typeof m === "object" &&
        typeof (m as MemoryDTO).id === "string" &&
        typeof (m as MemoryDTO).title === "string" &&
        typeof (m as MemoryDTO).body === "string",
    );
  } catch {
    return [];
  }
}

export function saveLocalMemories(records: MemoryDTO[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(records.slice(0, 200)));
  } catch {
    // quota
  }
}

export function upsertLocalMemory(
  input: Omit<MemoryDTO, "id" | "updatedAt"> & { id?: string },
): MemoryDTO {
  const records = loadLocalMemories();
  const id = input.id || crypto.randomUUID();
  const next: MemoryDTO = {
    id,
    type: input.type || "note",
    title: input.title,
    body: input.body,
    importance: input.importance || "normal",
    tags: input.tags || [],
    updatedAt: new Date().toISOString(),
  };
  const idx = records.findIndex((r) => r.id === id);
  if (idx >= 0) records[idx] = next;
  else records.unshift(next);
  saveLocalMemories(records);
  return next;
}

export function deleteLocalMemory(id: string): void {
  saveLocalMemories(loadLocalMemories().filter((r) => r.id !== id));
}

export function searchLocalMemories(query: string, limit = 8): MemoryDTO[] {
  const q = query.trim().toLowerCase();
  const all = loadLocalMemories();
  if (!q) return all.slice(0, limit);
  return all
    .filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.body.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q),
    )
    .slice(0, limit);
}

/** Compact memory block for chat body when cloud inject is unavailable. */
export function localMemoryContextForChat(): string {
  return formatMemoryForPrompt(loadLocalMemories().slice(0, 8));
}
