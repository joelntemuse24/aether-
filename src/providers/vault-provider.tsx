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
import { fetchCloudStatus } from "@/lib/conversations/cloud-client";
import {
  clearLocalVaultNotes,
  loadVaultNotes,
  saveVaultNotes,
  VAULT_MIGRATED_KEY,
  type VaultNote,
} from "@/lib/vault";

type VaultContextValue = {
  notes: VaultNote[];
  cloud: boolean;
  loading: boolean;
  vaultOpen: boolean;
  vaultFloating: boolean;
  /** list = note index; edit = editor (including new blank drafts). */
  view: "list" | "edit";
  activeNoteId: string | null;
  title: string;
  content: string;
  width: number;
  detachPoint: { x: number; y: number } | null;
  setVaultOpen: (open: boolean) => void;
  setVaultFloating: (floating: boolean) => void;
  setTitle: (title: string) => void;
  setContent: (content: string) => void;
  setWidth: (width: number) => void;
  setDetachPoint: (point: { x: number; y: number } | null) => void;
  setView: (view: "list" | "edit") => void;
  beginNote: (note?: VaultNote) => void;
  openVault: (opts?: { expandSidebar?: () => void }) => void;
  saveNote: () => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [cloud, setCloud] = useState(false);
  const [loading, setLoading] = useState(true);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultFloating, setVaultFloating] = useState(false);
  const [view, setView] = useState<"list" | "edit">("list");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled note");
  const [content, setContent] = useState("");
  const [width, setWidth] = useState(240);
  const [detachPoint, setDetachPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const migrating = useRef(false);

  const beginNote = useCallback((note?: VaultNote) => {
    // Always enter editor — previously "New note" stayed on the list because
    // empty Untitled had the same shape as list mode.
    setActiveNoteId(note?.id ?? null);
    setTitle(note?.title ?? "Untitled note");
    setContent(note?.content ?? "");
    setView("edit");
  }, []);

  const migrateLocalIfNeeded = useCallback(async () => {
    if (migrating.current) return;
    try {
      if (localStorage.getItem(VAULT_MIGRATED_KEY) === "1") return;
    } catch {
      return;
    }
    const local = loadVaultNotes();
    if (local.length === 0) {
      try {
        localStorage.setItem(VAULT_MIGRATED_KEY, "1");
      } catch {
        /* ignore */
      }
      return;
    }
    migrating.current = true;
    try {
      const res = await fetch("/api/vault/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: local.map((n) => ({ title: n.title, content: n.content })),
        }),
      });
      if (res.ok) {
        clearLocalVaultNotes();
        try {
          localStorage.setItem(VAULT_MIGRATED_KEY, "1");
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* keep local; retry next load */
    } finally {
      migrating.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (status !== "authenticated") {
        setCloud(false);
        setNotes(loadVaultNotes());
        return;
      }
      const st = await fetchCloudStatus(true);
      setCloud(!!st.cloud);
      if (!st.cloud) {
        setNotes(loadVaultNotes());
        return;
      }
      await migrateLocalIfNeeded();
      const res = await fetch("/api/vault", { cache: "no-store" });
      if (!res.ok) {
        setNotes(loadVaultNotes());
        setCloud(false);
        return;
      }
      const data = (await res.json()) as { notes?: VaultNote[] };
      setNotes(Array.isArray(data.notes) ? data.notes : []);
    } finally {
      setLoading(false);
    }
  }, [status, migrateLocalIfNeeded]);

  useEffect(() => {
    if (status === "loading") return;
    void refresh();
  }, [status, refresh]);

  const saveNote = useCallback(async () => {
    const nextTitle = title.trim() || "Untitled note";
    const payload = {
      id: activeNoteId ?? undefined,
      title: nextTitle,
      content,
    };

    if (cloud) {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail: "Couldn’t save to Vault. Try again.",
          }),
        );
        return;
      }
      const data = (await res.json()) as { note: VaultNote };
      setActiveNoteId(data.note.id);
      setTitle(data.note.title);
      setNotes((prev) => [
        data.note,
        ...prev.filter((n) => n.id !== data.note.id),
      ]);
      window.dispatchEvent(
        new CustomEvent("aether:notice", { detail: "Saved to Vault." }),
      );
      return;
    }

    const id = activeNoteId ?? crypto.randomUUID();
    const note: VaultNote = {
      id,
      title: nextTitle,
      content,
      updatedAt: Date.now(),
    };
    setNotes((previous) => {
      const next = [note, ...previous.filter((item) => item.id !== id)];
      saveVaultNotes(next);
      return next;
    });
    setActiveNoteId(id);
    window.dispatchEvent(
      new CustomEvent("aether:notice", {
        detail: "Saved to Vault on this device.",
      }),
    );
  }, [activeNoteId, cloud, content, title]);

  const deleteNote = useCallback(
    async (id: string) => {
      if (cloud) {
        const res = await fetch(`/api/vault/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: "Couldn’t delete note.",
            }),
          );
          return;
        }
      }
      setNotes((previous) => {
        const next = previous.filter((n) => n.id !== id);
        if (!cloud) saveVaultNotes(next);
        return next;
      });
      if (activeNoteId === id) {
        setActiveNoteId(null);
        setTitle("Untitled note");
        setContent("");
        setView("list");
      }
    },
    [activeNoteId, cloud],
  );

  const openVault = useCallback(
    (opts?: { expandSidebar?: () => void }) => {
      opts?.expandSidebar?.();
      setVaultFloating(false);
      // Open to the notes list (not a blank editor that looked "broken").
      setActiveNoteId(null);
      setTitle("Untitled note");
      setContent("");
      setView("list");
      setVaultOpen(true);
    },
    [],
  );

  const value = useMemo<VaultContextValue>(
    () => ({
      notes,
      cloud,
      loading,
      vaultOpen,
      vaultFloating,
      view,
      activeNoteId,
      title,
      content,
      width,
      detachPoint,
      setVaultOpen,
      setVaultFloating,
      setTitle,
      setContent,
      setWidth,
      setDetachPoint,
      setView,
      beginNote,
      openVault,
      saveNote,
      deleteNote,
      refresh,
    }),
    [
      notes,
      cloud,
      loading,
      vaultOpen,
      vaultFloating,
      view,
      activeNoteId,
      title,
      content,
      width,
      detachPoint,
      beginNote,
      openVault,
      saveNote,
      deleteNote,
      refresh,
    ],
  );

  return (
    <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within VaultProvider");
  return ctx;
}
