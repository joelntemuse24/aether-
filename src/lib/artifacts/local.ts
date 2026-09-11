/**
 * Browser-local artifacts when cloud DB is off or user is signed out.
 * Same shape as cloud summaries + full content for reopen.
 */

import type { ArtifactKind } from "@/lib/tools";
import { mergeProvenance, type ArtifactProvenance } from "./provenance";
import { bumpArtifactVersions, type ArtifactVersion } from "./versions";

export type LocalArtifact = {
  id: string;
  kind: ArtifactKind | string;
  title: string;
  language?: string;
  content: string;
  updatedAt: string;
  versions?: ArtifactVersion[];
  provenance?: ArtifactProvenance[];
};

const KEY = "aether:local-artifacts:v1";
const MAX = 40;

export function loadLocalArtifacts(): LocalArtifact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalArtifact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalArtifacts(items: LocalArtifact[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* quota */
  }
}

export function upsertLocalArtifact(
  input: Omit<LocalArtifact, "updatedAt"> & { updatedAt?: string },
): LocalArtifact {
  const prevRow = loadLocalArtifacts().find((a) => a.id === input.id);
  const content = input.content ?? "";
  const versions =
    input.versions ??
    bumpArtifactVersions(prevRow?.versions, prevRow?.content ?? "", content);
  const provenance =
    input.provenance ??
    mergeProvenance(prevRow?.provenance, []);
  const next: LocalArtifact = {
    id: input.id,
    kind: input.kind || "document",
    title: input.title || "Artifact",
    language: input.language,
    content,
    updatedAt: input.updatedAt || new Date().toISOString(),
    versions,
    provenance,
  };
  const prev = loadLocalArtifacts().filter((a) => a.id !== next.id);
  saveLocalArtifacts([next, ...prev]);
  return next;
}

export function getLocalArtifact(id: string): LocalArtifact | null {
  return loadLocalArtifacts().find((a) => a.id === id) ?? null;
}

export function deleteLocalArtifact(id: string): void {
  saveLocalArtifacts(loadLocalArtifacts().filter((a) => a.id !== id));
}
