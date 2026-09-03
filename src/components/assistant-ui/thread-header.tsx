"use client";

import { useEffect, useRef, useState, type FC } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { CheckIcon, PencilIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sticky conversation title above the thread — rename inline like Claude/ChatGPT.
 */
export const ThreadHeader: FC = () => {
  const aui = useAui();
  const title = useAuiState(
    (s) => s.threadListItem.title?.trim() || "New conversation",
  );
  const isEmpty = useAuiState((s) => s.thread.messages.length === 0);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (isEmpty) return null;

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title) return;
    try {
      aui.threadListItem().rename(next);
    } catch {
      setDraft(title);
    }
  };

  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 border-b border-[var(--border-subtle)] bg-[var(--canvas)]/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="mx-auto flex h-11 max-w-[var(--thread-max-width)] items-center gap-2">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(title);
                  setEditing(false);
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--elevated)] px-2 py-1 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]/40"
              aria-label="Conversation title"
              maxLength={80}
            />
            <button
              type="submit"
              className="flex size-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Save title"
            >
              <CheckIcon className="size-3.5" />
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={cn(
                "group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--hover-overlay)]",
              )}
              title="Rename conversation"
            >
              <h2 className="truncate font-[family-name:var(--font-sc)] text-[13px] font-medium tracking-[0.06em] text-[var(--text)]">
                {title}
              </h2>
              <PencilIcon className="size-3 shrink-0 text-[var(--muted-soft)] opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </>
        )}
      </div>
    </header>
  );
};
