/** Browser-local projects when cloud DB is off or user is signed out. */

import type { ProjectDTO } from "./types";

const KEY = "aether:local-projects:v1";

export function loadLocalProjects(): ProjectDTO[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectDTO[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalProjects(projects: ProjectDTO[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(projects));
  } catch {
    /* quota */
  }
}

export function createLocalProject(title: string): ProjectDTO {
  const project: ProjectDTO = {
    id: crypto.randomUUID(),
    title: title.trim() || "Untitled project",
    updatedAt: new Date().toISOString(),
  };
  const next = [project, ...loadLocalProjects()];
  saveLocalProjects(next);
  return project;
}

export function updateLocalProject(
  id: string,
  patch: { title?: string; instructions?: string | null },
): ProjectDTO | null {
  const list = loadLocalProjects();
  const idx = list.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const prev = list[idx]!;
  const next: ProjectDTO = {
    ...prev,
    ...(patch.title !== undefined
      ? { title: patch.title.trim() || prev.title }
      : {}),
    ...(patch.instructions !== undefined
      ? {
          instructions: patch.instructions?.trim() || undefined,
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  const copy = [...list];
  copy[idx] = next;
  saveLocalProjects(copy);
  return next;
}

export function deleteLocalProject(id: string): void {
  saveLocalProjects(loadLocalProjects().filter((p) => p.id !== id));
}
