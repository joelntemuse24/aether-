"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ArtifactKind } from "@/lib/tools";

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
};

type ArtifactContextValue = {
  artifact: Artifact | null;
  open: boolean;
  openArtifact: (artifact: Artifact) => void;
  closeArtifact: () => void;
  toggleArtifact: () => void;
};

const ArtifactContext = createContext<ArtifactContextValue | null>(null);

export function ArtifactProvider({ children }: { children: ReactNode }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [open, setOpen] = useState(false);

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

  const value = useMemo(
    () => ({
      artifact,
      open,
      openArtifact,
      closeArtifact,
      toggleArtifact,
    }),
    [artifact, open, openArtifact, closeArtifact, toggleArtifact],
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
