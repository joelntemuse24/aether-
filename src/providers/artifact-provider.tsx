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
import {
  getLocalArtifact,
  loadLocalArtifacts,
  upsertLocalArtifact,
  type LocalArtifact,
} from "@/lib/artifacts/local";
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
  /** True when loaded from /api/artifacts (cloud). */
  persisted?: boolean;
  /** True when saved in browser localStorage. */
  local?: boolean;
};

export type SavedArtifactSummary = {
  id: string;
  kind: string;
  title: string;
  language?: string;
  updatedAt?: string;
  source: "cloud" | "local";
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
  /** Persist current artifact content (cloud and/or local). */
  persistArtifactContent: (content: string) => Promise<boolean>;
  /** Explicit Save — works offline; uses cloud when signed in + DB. */
  saveCurrentArtifact: () => Promise<boolean>;
  /** Keep session/local list in sync when a tool creates an artifact. */
  rememberSessionArtifact: (artifact: Artifact) => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

function localToSummary(a: LocalArtifact): SavedArtifactSummary {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    language: a.language,
    updatedAt: a.updatedAt,
    source: "local",
  };
}

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

  const mergeLocalIntoSaved = useCallback(
    (cloudList: SavedArtifactSummary[]) => {
      const local = loadLocalArtifacts().map(localToSummary);
      const cloudIds = new Set(cloudList.map((a) => a.id));
      // Prefer cloud copy when same id; append local-only.
      const localsOnly = local.filter((a) => !cloudIds.has(a.id));
      setSaved([...cloudList, ...localsOnly]);
    },
    [],
  );

  const refreshSaved = useCallback(async () => {
    // Always show local artifacts.
    const local = loadLocalArtifacts().map(localToSummary);

    if (status !== "authenticated") {
      setSavedCloud(false);
      setSaved(local);
      return;
    }
    try {
      const st = await fetch("/api/conversations/status", { cache: "no-store" });
      const data = (await st.json()) as { cloud?: boolean };
      setSavedCloud(!!data.cloud);
      if (!data.cloud) {
        setSaved(local);
        return;
      }
      const res = await fetch("/api/artifacts", { cache: "no-store" });
      if (!res.ok) {
        setSaved(local);
        return;
      }
      const body = (await res.json()) as {
        artifacts?: Array<{
          id: string;
          kind: string;
          title: string;
          language?: string;
          updatedAt?: string;
        }>;
      };
      const cloudList: SavedArtifactSummary[] = (body.artifacts ?? []).map(
        (a) => ({
          id: a.id,
          kind: a.kind,
          title: a.title,
          language: a.language,
          updatedAt: a.updatedAt,
          source: "cloud" as const,
        }),
      );
      mergeLocalIntoSaved(cloudList);
    } catch {
      setSaved(local);
    }
  }, [status, mergeLocalIntoSaved]);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  const rememberSessionArtifact = useCallback(
    (a: Artifact) => {
      if (!a.code?.trim()) return;
      upsertLocalArtifact({
        id: a.id,
        kind: a.kind || "document",
        title: a.title || "Artifact",
        language: a.language,
        content: a.code,
      });
      void refreshSaved();
    },
    [refreshSaved],
  );

  const openSavedById = useCallback(
    async (id: string) => {
      // Local first (works offline / no cloud).
      const local = getLocalArtifact(id);
      if (local) {
        openArtifact({
          id: local.id,
          title: local.title,
          kind: (local.kind as ArtifactKind) || "document",
          language: local.language,
          code: local.content,
          local: true,
          persisted: false,
        });
        return true;
      }
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
        // Mirror to local for offline reopen.
        upsertLocalArtifact({
          id: a.id,
          kind: a.kind,
          title: a.title,
          language: a.language,
          content: a.content,
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
      if (!current?.id) return false;

      // Always keep a local copy so sidebar/reopen work without cloud.
      upsertLocalArtifact({
        id: current.id,
        kind: current.kind || "document",
        title: current.title,
        language: current.language,
        content,
      });

      if (current.persisted) {
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
          if (!res.ok) {
            setArtifact((prev) =>
              prev && prev.id === current.id
                ? { ...prev, code: content, local: true }
                : prev,
            );
            void refreshSaved();
            return true; // local saved even if cloud failed
          }
          setArtifact((prev) =>
            prev && prev.id === current.id
              ? { ...prev, code: content, persisted: true, local: true }
              : prev,
          );
          void refreshSaved();
          return true;
        } catch {
          setArtifact((prev) =>
            prev && prev.id === current.id
              ? { ...prev, code: content, local: true }
              : prev,
          );
          void refreshSaved();
          return true;
        }
      }

      setArtifact((prev) =>
        prev && prev.id === current.id
          ? { ...prev, code: content, local: true }
          : prev,
      );
      void refreshSaved();
      return true;
    },
    [artifact, refreshSaved],
  );

  const saveCurrentArtifact = useCallback(async () => {
    const current = artifact;
    if (!current?.id || !current.code) return false;

    upsertLocalArtifact({
      id: current.id,
      kind: current.kind || "document",
      title: current.title,
      language: current.language,
      content: current.code,
    });

    if (status === "authenticated" && savedCloud) {
      try {
        const res = await fetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: current.id,
            kind: current.kind || "document",
            title: current.title,
            language: current.language,
            content: current.code,
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            artifact?: { id: string };
          };
          const id = body.artifact?.id || current.id;
          setArtifact((prev) =>
            prev
              ? { ...prev, id, persisted: true, local: true }
              : prev,
          );
          void refreshSaved();
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: "Artifact saved to your account.",
            }),
          );
          return true;
        }
      } catch {
        /* fall through to local notice */
      }
    }

    setArtifact((prev) =>
      prev ? { ...prev, local: true, persisted: false } : prev,
    );
    void refreshSaved();
    window.dispatchEvent(
      new CustomEvent("aether:notice", {
        detail: "Artifact saved on this device.",
      }),
    );
    return true;
  }, [artifact, refreshSaved, savedCloud, status]);

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
      saveCurrentArtifact,
      rememberSessionArtifact,
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
      saveCurrentArtifact,
      rememberSessionArtifact,
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
