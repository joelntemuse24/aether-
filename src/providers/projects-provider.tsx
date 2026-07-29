"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/providers/session-provider";
import type { ProjectDTO } from "@/lib/projects/types";

type ProjectsContextValue = {
  projects: ProjectDTO[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  activeProject: ProjectDTO | null;
  refresh: () => Promise<void>;
  create: (title: string) => Promise<ProjectDTO | null>;
  remove: (id: string) => Promise<void>;
  cloud: boolean;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);
const ACTIVE_KEY = "aether:active-project";

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(
    null,
  );
  const [cloud, setCloud] = useState(false);

  useEffect(() => {
    try {
      setActiveProjectIdState(localStorage.getItem(ACTIVE_KEY));
    } catch {
      // ignore
    }
  }, []);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") {
      setProjects([]);
      setCloud(false);
      return;
    }
    try {
      const st = await fetch("/api/conversations/status", { cache: "no-store" });
      const data = (await st.json()) as { cloud?: boolean };
      setCloud(!!data.cloud);
      if (!data.cloud) {
        setProjects([]);
        return;
      }
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { projects?: ProjectDTO[] };
      setProjects(body.projects ?? []);
    } catch {
      // ignore
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (title: string) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { project: ProjectDTO };
      await refresh();
      setActiveProjectId(body.project.id);
      return body.project;
    },
    [refresh, setActiveProjectId],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (activeProjectId === id) setActiveProjectId(null);
      await refresh();
    },
    [activeProjectId, refresh, setActiveProjectId],
  );

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ?? null;

  const value = useMemo(
    () => ({
      projects,
      activeProjectId,
      setActiveProjectId,
      activeProject,
      refresh,
      create,
      remove,
      cloud,
    }),
    [
      projects,
      activeProjectId,
      setActiveProjectId,
      activeProject,
      refresh,
      create,
      remove,
      cloud,
    ],
  );

  return (
    <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects must be used within ProjectsProvider");
  return ctx;
}
