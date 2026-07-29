"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  deleteLocalMemory,
  loadLocalMemories,
  upsertLocalMemory,
} from "@/lib/memory/local";
import type { MemoryDTO } from "@/lib/memory/types";

/**
 * Settings panel: inspect/edit curated memory (cloud when signed in + DB,
 * otherwise browser localStorage).
 */
export function MemorySettingsPanel() {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const [memories, setMemories] = useState<MemoryDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [cloud, setCloud] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (signedIn) {
        const statusRes = await fetch("/api/conversations/status", {
          cache: "no-store",
        });
        const st = (await statusRes.json()) as { cloud?: boolean };
        setCloud(!!st.cloud);
        if (st.cloud) {
          const res = await fetch("/api/memory", { cache: "no-store" });
          if (!res.ok) throw new Error("Could not load cloud memory");
          const data = (await res.json()) as { memories?: MemoryDTO[] };
          setMemories(data.memories ?? []);
          return;
        }
      }
      setCloud(false);
      setMemories(loadLocalMemories());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory");
      setMemories(loadLocalMemories());
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    if (!draftTitle.trim() || !draftBody.trim()) return;
    if (cloud && signedIn) {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draftTitle.trim(),
          body: draftBody.trim(),
          type: "note",
        }),
      });
      if (!res.ok) {
        setError("Could not save memory");
        return;
      }
    } else {
      upsertLocalMemory({
        title: draftTitle.trim(),
        body: draftBody.trim(),
        type: "note",
        importance: "normal",
        tags: [],
      });
    }
    setDraftTitle("");
    setDraftBody("");
    await refresh();
  };

  const remove = async (id: string) => {
    if (cloud && signedIn) {
      await fetch(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
    } else {
      deleteLocalMemory(id);
    }
    await refresh();
  };

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-5">
      <div className="flex items-center gap-2">
        <BrainIcon className="size-4 text-[var(--muted)]" />
        <span className="text-sm font-medium text-[var(--text)]">
          What Aether knows about you
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Curated memory used across chats
        {cloud
          ? " (synced to your account)."
          : " (stored in this browser until you sign in with cloud storage)."}{" "}
        The model can also write memories when tools are on.
      </p>

      {error && (
        <p className="text-xs text-[var(--error-text)]">{error}</p>
      )}

      <div className="space-y-2">
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder="Title (e.g. Prefers concise feedback)"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]/40"
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          placeholder="Details…"
          rows={2}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]/40"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void add()}
          disabled={!draftTitle.trim() || !draftBody.trim()}
        >
          <PlusIcon className="mr-1 size-3.5" />
          Add memory
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-[var(--muted)]">Loading…</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-[var(--muted-soft)]">No memories yet.</p>
      ) : (
        <ul className="max-h-48 space-y-2 overflow-y-auto">
          {memories.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-[var(--text)]">
                    {m.title}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--muted-soft)]">
                    {m.type}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[11px] text-[var(--muted)]">
                    {m.body}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(m.id)}
                  className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
                  aria-label="Delete memory"
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
