"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "@/providers/session-provider";
import type { ProjectDTO } from "@/lib/projects/types";
import {
  bindProjectToConversation,
  readConversationProjectId,
} from "@/lib/conversation-project";
import { readThreadIdFromLocation } from "@/lib/thread-url";

type ProjectsContextValue = {
  projects: ProjectDTO[];
  activeProjectId: string | null;
  setActiveProjectId: (
    id: string | null,
    opts?: { bindConversation?: boolean },
  ) => void;
  activeProject: ProjectDTO | null;
  refresh: () => Promise<void>;
  create: (title: string) => Promise<ProjectDTO | null>;
  update: (
    id: string,
    patch: { title?: string; instructions?: string | null },
  ) => Promise<ProjectDTO | null>;
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
  const syncingFromThread = useRef(false);
  const activeProjectIdRef = useRef<string | null>(null);
  const syncGeneration = useRef(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ACTIVE_KEY);
      setActiveProjectIdState(stored);
      activeProjectIdRef.current = stored;
    } catch {
      // ignore
    }
  }, []);

  const setActiveProjectId = useCallback(
    (id: string | null, opts?: { bindConversation?: boolean }) => {
      setActiveProjectIdState(id);
      activeProjectIdRef.current = id;
      try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
      } catch {
        // ignore
      }
      const shouldBind =
        opts?.bindConversation === true
          ? true
          : opts?.bindConversation === false
            ? false
            : !syncingFromThread.current;
      if (shouldBind) {
        const conversationId = readThreadIdFromLocation();
        if (conversationId) {
          void bindProjectToConversation(conversationId, id);
        }
      }
    },
    [],
  );

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

  // Restore project from the active conversation when the thread URL changes.
  // New chats with no binding inherit the session-active project.
  useEffect(() => {
    const syncFromThread = () => {
      const conversationId = readThreadIdFromLocation();
      if (!conversationId) return;
      const generation = ++syncGeneration.current;
      void (async () => {
        const bound = await readConversationProjectId(conversationId);
        if (generation !== syncGeneration.current) return; // stale switch
        syncingFromThread.current = true;
        if (bound) {
          setActiveProjectId(bound, { bindConversation: false });
        } else if (activeProjectIdRef.current) {
          setActiveProjectId(activeProjectIdRef.current, {
            bindConversation: true,
          });
        } else {
          setActiveProjectId(null, { bindConversation: false });
        }
        syncingFromThread.current = false;
      })();
    };

    syncFromThread();
    window.addEventListener("aether:thread-switched", syncFromThread);
    window.addEventListener("popstate", syncFromThread);
    return () => {
      window.removeEventListener("aether:thread-switched", syncFromThread);
      window.removeEventListener("popstate", syncFromThread);
    };
  }, [setActiveProjectId]);

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

  const update = useCallback(
    async (
      id: string,
      patch: { title?: string; instructions?: string | null },
    ) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { project: ProjectDTO };
      await refresh();
      return body.project;
    },
    [refresh],
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
      update,
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
      update,
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
