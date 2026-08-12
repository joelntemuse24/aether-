"use client";

import { useState, type FC } from "react";
import {
  BookOpenIcon,
  GripVerticalIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import type { VaultNote } from "@/lib/vault";
import { SoftConfirm } from "@/components/ui/soft-dialog";
import { cn } from "@/lib/utils";

type VaultSidebarProps = {
  notes: VaultNote[];
  activeNoteId: string | null;
  /** Explicit list vs editor — empty Untitled draft is still "edit". */
  view: "list" | "edit";
  title: string;
  content: string;
  width: number;
  cloud?: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onWidthChange: (value: number) => void;
  onNew: () => void;
  onSelect: (note: VaultNote) => void;
  onSave: () => void;
  onBackToList?: () => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
  onDetach: (point: { x: number; y: number }) => void;
  className?: string;
};

export const VaultSidebar: FC<VaultSidebarProps> = ({
  notes,
  view,
  title,
  content,
  width,
  cloud,
  onTitleChange,
  onContentChange,
  onWidthChange,
  onNew,
  onSelect,
  onSave,
  onBackToList,
  onDelete,
  onClose,
  onDetach,
  className,
}) => {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = notes.find((n) => n.id === pendingDeleteId) ?? null;
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [resizeStart, setResizeStart] = useState<{
    x: number;
    width: number;
  } | null>(null);
  const editing = view === "edit";

  return (
    <aside
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--canvas)]",
        className,
      )}
      style={{ width }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-3">
        <BookOpenIcon className="size-4 text-[var(--muted)]" />
        <span className="min-w-0 flex-1 text-[13px] font-medium text-[var(--text)]">
          Vault
        </span>
        <span className="text-[10px] text-[var(--muted-soft)]">
          {cloud ? "Synced" : "This device"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Close Vault"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {!editing ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <button
            type="button"
            onClick={onNew}
            className="mx-3 mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover-overlay)]"
          >
            + New note
          </button>
          <div className="mt-4 px-3 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-soft)]">
            Saved notes
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {notes.length ? (
              notes.map((note) => (
                <div
                  key={note.id}
                  className="group mb-1 flex items-start gap-1 rounded-lg hover:bg-[var(--hover-overlay)]"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(note)}
                    className="min-w-0 flex-1 px-2.5 py-2 text-left"
                  >
                    <span className="block truncate text-[12px] font-medium text-[var(--text)]">
                      {note.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-[var(--muted-soft)]">
                      {note.content || "Empty note"}
                    </span>
                  </button>
                  {onDelete ? (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(note.id)}
                      className="mt-1.5 me-1 flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--muted)] opacity-0 transition-opacity hover:text-[var(--text)] group-hover:opacity-100 max-md:opacity-100"
                      aria-label={`Delete ${note.title}`}
                      title="Delete"
                    >
                      <TrashIcon className="size-3" />
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="px-1 py-5 text-[11px] text-[var(--muted-soft)]">
                Nothing saved yet.
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div
            className="flex touch-none items-center gap-2 border-b border-[var(--border)] px-3 py-2.5"
            style={{ cursor: dragStart ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("input,button")) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragStart({ x: e.clientX, y: e.clientY });
            }}
            onPointerMove={(e) => {
              if (
                dragStart &&
                Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 10
              ) {
                onDetach({
                  x: Math.max(12, e.clientX - 28),
                  y: Math.max(12, e.clientY - 18),
                });
              }
            }}
            onPointerUp={() => setDragStart(null)}
          >
            <GripVerticalIcon className="size-3.5 text-[var(--muted-soft)]" />
            {onBackToList ? (
              <button
                type="button"
                onClick={onBackToList}
                className="rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--muted)] hover:text-[var(--text)]"
              >
                Notes
              </button>
            ) : null}
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              maxLength={42}
              aria-label="Note title"
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[var(--text)] outline-none"
            />
            <button
              type="button"
              onClick={onSave}
              className="rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--accent)]"
            >
              Save
            </button>
          </div>
          <div className="px-3 pt-2 text-[10px] text-[var(--muted-soft)]">
            Drag header to detach · drag edge to resize
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder="Paste a link, save an output, or leave yourself a thought…"
              className="min-h-0 w-full flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-[var(--text)] outline-none"
            />
          </div>
        </>
      )}

      <div
        className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setResizeStart({ x: e.clientX, width });
        }}
        onPointerMove={(e) => {
          if (resizeStart) {
            onWidthChange(
              Math.min(
                460,
                Math.max(220, resizeStart.width + e.clientX - resizeStart.x),
              ),
            );
          }
        }}
        onPointerUp={() => setResizeStart(null)}
      />

      <SoftConfirm
        open={!!pendingDelete}
        title="Delete note?"
        description={
          pendingDelete
            ? `“${pendingDelete.title || "Untitled note"}” will be removed from Vault.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onClose={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDelete && onDelete) onDelete(pendingDelete.id);
        }}
      />
    </aside>
  );
};

type FloatingVaultProps = {
  title: string;
  content: string;
  initialPosition: { x: number; y: number } | null;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onDock: () => void;
  onClose: () => void;
};

export const FloatingVault: FC<FloatingVaultProps> = ({
  title,
  content,
  initialPosition,
  onTitleChange,
  onContentChange,
  onSave,
  onDock,
  onClose,
}) => {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [size, setSize] = useState({ width: 336, height: 440 });
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [resize, setResize] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
  } | null>(null);

  const x = position?.x ?? initialPosition?.x ?? 16;
  const y = position?.y ?? initialPosition?.y ?? 88;

  return (
    <section
      className="fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)] shadow-2xl animate-[fadeIn_150ms_ease-out]"
      style={{ left: x, top: y, width: size.width, height: size.height }}
    >
      <div
        className="flex touch-none items-center gap-2 border-b border-[var(--border)] px-3 py-2.5"
        style={{ cursor: drag ? "grabbing" : "grab" }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("input,button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ x: e.clientX, y: e.clientY, originX: x, originY: y });
        }}
        onPointerMove={(e) => {
          if (drag) {
            setPosition({
              x: Math.max(8, drag.originX + e.clientX - drag.x),
              y: Math.max(8, drag.originY + e.clientY - drag.y),
            });
          }
        }}
        onPointerUp={() => setDrag(null)}
      >
        <GripVerticalIcon className="size-3.5 shrink-0 text-[var(--muted-soft)]" />
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={42}
          aria-label="Vault name"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[var(--text)] outline-none"
        />
        <button
          type="button"
          onClick={onSave}
          className="rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--accent)]"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onDock}
          className="rounded-md px-1.5 py-1 text-[10px] font-medium text-[var(--muted)]"
        >
          Dock
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
          aria-label="Close Vault"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="Paste a link, save an output, or leave yourself a thought…"
          className="min-h-[12rem] w-full flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-[var(--text)] outline-none"
        />
      </div>
      <div
        className="absolute right-10 top-0 z-10 size-5 cursor-ne-resize"
        title="Resize Vault"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setResize({
            x: e.clientX,
            y: e.clientY,
            width: size.width,
            height: size.height,
            top: y,
          });
        }}
        onPointerMove={(e) => {
          if (!resize) return;
          const dy = e.clientY - resize.y;
          setSize({
            width: Math.min(620, Math.max(260, resize.width + e.clientX - resize.x)),
            height: Math.min(720, Math.max(240, resize.height - dy)),
          });
          setPosition({ x, y: Math.max(8, resize.top + dy) });
        }}
        onPointerUp={() => setResize(null)}
      />
    </section>
  );
};
