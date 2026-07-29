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

import type { ArtifactKind } from "@/lib/tools";
import { useSession } from "@/providers/session-provider";

export type Artifact = {
  id: string;
  title: string;
  /** Artifact type. Defaults to "code" when omitted (back-compat). */
  kind?: ArtifactKind;
  /** Programming language for code artifacts. */
  language?: string;
  /**
   * Primary content: source code, markdown, JSON text, SVG markup, or an
   * image data/URL depending on `kind`.
   */
  code: string;
  /** MIME type for image artifacts. */
  mime?: string;
  /** True when loaded from /api/artifacts. */
  persisted?: boolean;
};

export type SavedArtifactSummary = {
  id: string;
  kind: string;
  title: string;
  language?: string;
  updatedAt?: string;
};

type ArtifactContextValue = {
  artifact: Artifact | null;
  open: boolean;
  openArtifact: (artifact: Artifact) => void;
  closeArtifact: () => void;
  toggleArtifact: () => void;
  saved: SavedArtifactSummary[];
  savedCloud: boolean;
  refreshSaved: () => Promise<void>;
  openSavedById: (id: string) => Promise<boolean>;
  /** Persist current artifact content when it was saved to the cloud. */
  persistArtifactContent: (content: string) => Promise<boolean>;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

export function ArtifactProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedArtifactSummary[]>([]);
  const [savedCloud, setSavedCloud] = useState(false);

  const openArtifact = useCallback((next: Artifact) => {
    setArtifact(next);
    setOpen(true);
  }, []);

  const closeArtifact = useCallback(() => {
    setOpen(false);
  }, []);

  const toggleArtifact = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const refreshSaved = useCallback(async () => {
    if (status !== "authenticated") {
      setSaved([]);
      setSavedCloud(false);
      return;
    }
    try {
      const st = await fetch("/api/conversations/status", { cache: "no-store" });
      const data = (await st.json()) as { cloud?: boolean };
      setSavedCloud(!!data.cloud);
      if (!data.cloud) {
        setSaved([]);
        return;
      }
      const res = await fetch("/api/artifacts", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as {
        artifacts?: Array<{
          id: string;
          kind: string;
          title: string;
          language?: string;
          updatedAt?: string;
        }>;
      };
      setSaved(
        (body.artifacts ?? []).map((a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          language: a.language,
          updatedAt: a.updatedAt,
        })),
      );
    } catch {
      // ignore
    }
  }, [status]);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  const openSavedById = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(
          `/api/artifacts?id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return false;
        const body = (await res.json()) as {
          artifact?: {
            id: string;
            kind: string;
            title: string;
            language?: string;
            content: string;
          };
        };
        const a = body.artifact;
        if (!a) return false;
        openArtifact({
          id: a.id,
          title: a.title,
          kind: (a.kind as ArtifactKind) || "document",
          language: a.language,
          code: a.content,
          persisted: true,
        });
        return true;
      } catch {
        return false;
      }
    },
    [openArtifact],
  );

  const persistArtifactContent = useCallback(
    async (content: string) => {
      const current = artifact;
      if (!current?.persisted || !current.id) return false;
      try {
        const res = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: current.id,
            kind: current.kind || "document",
            title: current.title,
            language: current.language,
            content,
          }),
        });
        if (!res.ok) return false;
        setArtifact((prev) =>
          prev && prev.id === current.id ? { ...prev, code: content } : prev,
        );
        void refreshSaved();
        return true;
      } catch {
        return false;
      }
    },
    [artifact, refreshSaved],
  );

  const value = useMemo(
    () => ({
      artifact,
      open,
      openArtifact,
      closeArtifact,
      toggleArtifact,
      saved,
      savedCloud,
      refreshSaved,
      openSavedById,
      persistArtifactContent,
    }),
    [
      artifact,
      open,
      openArtifact,
      closeArtifact,
      toggleArtifact,
      saved,
      savedCloud,
      refreshSaved,
      openSavedById,
      persistArtifactContent,
    ],
  );

  return (
    <ArtifactContext.Provider value={value}>{children}</ArtifactContext.Provider>
  );
}

export function useArtifact() {
  const ctx = useContext(ArtifactContext);
  if (!ctx) throw new Error("useArtifact must be used within ArtifactProvider");
  return ctx;
}
