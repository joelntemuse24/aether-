"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  Grid2X2Icon,
  ImageIcon,
  ListIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  downloadDriveFile,
  fileTypeLabel,
  formatBytes,
  listDriveFiles,
  type DriveFileItem,
} from "@/lib/google-drive";
import type { PendingAttachment } from "@/lib/attachments";
import { MAX_ATTACHMENTS } from "@/lib/attachments";
import { useAttachments } from "@/providers/attachments-provider";

type ViewMode = "grid" | "list";
type TypeFilter = "all" | "recent" | "pdf" | "image" | "doc" | "sheet";

type Breadcrumb = { id: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (attachments: PendingAttachment[], errors: string[]) => void;
};

const TYPE_FILTERS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recent" },
  { id: "pdf", label: "PDF" },
  { id: "image", label: "Images" },
  { id: "doc", label: "Docs" },
  { id: "sheet", label: "Sheets" },
];

export function DriveBrowserModal({ open, onClose, onSelect }: Props) {
  const titleId = useId();
  const { remainingSlots } = useAttachments();
  const [view, setView] = useState<ViewMode>("grid");
  const [type, setType] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([
    { id: "root", name: "My Drive" },
  ]);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Map<string, DriveFileItem>>(
    new Map(),
  );
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [slotHint, setSlotHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const folderId = breadcrumbs[breadcrumbs.length - 1]?.id || "root";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDriveFiles({
        folderId: type === "recent" || debouncedQuery ? undefined : folderId,
        q: debouncedQuery || undefined,
        type,
      });
      setFiles(result.files);
    } catch (err) {
      setFiles([]);
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [folderId, debouncedQuery, type]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const cancelDownload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDownloading(false);
  }, []);

  const requestClose = useCallback(() => {
    if (downloading) cancelDownload();
    onClose();
  }, [downloading, cancelDownload, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  // Reset when opening; abort in-flight download when closing
  useEffect(() => {
    if (open) {
      setSelected(new Map());
      setProgress({});
      setQuery("");
      setDebouncedQuery("");
      setType("all");
      setBreadcrumbs([{ id: "root", name: "My Drive" }]);
      setSlotHint(null);
    } else {
      abortRef.current?.abort();
      abortRef.current = null;
      setDownloading(false);
    }
  }, [open]);

  const toggleSelect = (file: DriveFileItem) => {
    if (file.isFolder || downloading) return;

    const isSelected = selected.has(file.id);
    if (isSelected) {
      setSlotHint(null);
      setSelected((prev) => {
        const next = new Map(prev);
        next.delete(file.id);
        return next;
      });
      return;
    }

    if (selected.size >= remainingSlots) {
      setSlotHint(
        remainingSlots <= 0
          ? `Maximum of ${MAX_ATTACHMENTS} files already attached.`
          : `You can select up to ${remainingSlots} more file${remainingSlots === 1 ? "" : "s"}.`,
      );
      return;
    }

    setSlotHint(null);
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(file.id, file);
      return next;
    });
  };

  const openFolder = (file: DriveFileItem) => {
    if (!file.isFolder || downloading) return;
    setType("all");
    setQuery("");
    setDebouncedQuery("");
    setBreadcrumbs((b) => [...b, { id: file.id, name: file.name }]);
    setSelected(new Map());
  };

  const goToBreadcrumb = (index: number) => {
    if (downloading) return;
    setBreadcrumbs((b) => b.slice(0, index + 1));
    setType("all");
    setQuery("");
    setDebouncedQuery("");
    setSelected(new Map());
  };

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  const handleConfirm = async () => {
    if (selectedList.length === 0 || downloading || remainingSlots <= 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setDownloading(true);

    const attachments: PendingAttachment[] = [];
    const errors: string[] = [];
    const toDownload = selectedList.slice(0, remainingSlots);

    try {
      for (const file of toDownload) {
        if (controller.signal.aborted) break;
        setProgress((p) => ({ ...p, [file.id]: 5 }));
        try {
          const result = await downloadDriveFile(
            file.id,
            file.name,
            file.mimeType,
            (pct) => setProgress((p) => ({ ...p, [file.id]: pct })),
            controller.signal,
          );
          if (result.attachment) attachments.push(result.attachment);
          if (result.error) errors.push(result.error);
        } catch (err) {
          if (controller.signal.aborted) {
            errors.push("Download cancelled.");
            break;
          }
          errors.push(
            err instanceof Error
              ? err.message
              : `Failed to download ${file.name}`,
          );
        }
      }
    } finally {
      abortRef.current = null;
      setDownloading(false);
    }

    if (attachments.length > 0 || errors.length > 0) {
      onSelect(attachments, errors);
    }
    onClose();
    // Return focus to the composer so typing works immediately after attach
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Message input"]',
      );
      input?.focus();
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={requestClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex h-[min(720px,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--canvas)] shadow-none animate-[fadeIn_150ms_ease-out]"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <GoogleDriveIcon className="size-5 shrink-0" />
            <h2
              id={titleId}
              className="truncate font-[family-name:var(--font-sc)] text-[14px] font-medium tracking-[0.06em] text-[var(--text)]"
            >
              Google Drive
            </h2>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="rounded p-1 text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label={downloading ? "Cancel download and close" : "Close"}
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="space-y-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-soft)]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Drive"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 pl-8 pr-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/40"
              />
            </div>
            <div className="flex shrink-0 items-center rounded-lg border border-[var(--border)] p-0.5">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  view === "grid"
                    ? "bg-[var(--elevated-deep)] text-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]",
                )}
                aria-label="Grid view"
              >
                <Grid2X2Icon className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  view === "list"
                    ? "bg-[var(--elevated-deep)] text-[var(--text)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]",
                )}
                aria-label="List view"
              >
                <ListIcon className="size-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-lg p-2 text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)] disabled:opacity-40"
              aria-label="Refresh"
            >
              <RefreshCwIcon
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setType(f.id);
                  if (f.id === "recent") {
                    setQuery("");
                    setDebouncedQuery("");
                  }
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  type === f.id
                    ? "bg-[var(--accent-muted)] text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Breadcrumbs */}
          {type !== "recent" && !debouncedQuery && (
            <nav
              className="flex flex-wrap items-center gap-0.5 text-xs text-[var(--muted)]"
              aria-label="Folder path"
            >
              {breadcrumbs.map((crumb, i) => (
                <span key={crumb.id} className="flex items-center gap-0.5">
                  {i > 0 && <ChevronRightIcon className="size-3 opacity-50" />}
                  <button
                    type="button"
                    onClick={() => goToBreadcrumb(i)}
                    className={cn(
                      "rounded px-1 py-0.5 transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]",
                      i === breadcrumbs.length - 1 && "text-[var(--text)]",
                    )}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {loading && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-[var(--muted)]">
              <Loader2Icon className="size-5 animate-spin" />
              <span className="text-sm">Loading files…</span>
            </div>
          )}

          {!loading && error && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 px-4 text-center">
              <p className="text-sm text-[var(--error-text)]">{error}</p>
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          )}

          {!loading && !error && files.length === 0 && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-[var(--muted-soft)]">
              <FolderIcon className="size-8 opacity-40" />
              <p className="text-sm">
                {debouncedQuery
                  ? "No files match your search"
                  : "This folder is empty"}
              </p>
            </div>
          )}

          {!loading && !error && files.length > 0 && view === "grid" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {files.map((file) => (
                <FileCard
                  key={file.id}
                  file={file}
                  selected={selected.has(file.id)}
                  progress={progress[file.id]}
                  onOpen={() =>
                    file.isFolder ? openFolder(file) : toggleSelect(file)
                  }
                  onToggle={() => toggleSelect(file)}
                />
              ))}
            </div>
          )}

          {!loading && !error && files.length > 0 && view === "list" && (
            <div className="flex flex-col gap-0.5">
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  selected={selected.has(file.id)}
                  progress={progress[file.id]}
                  onOpen={() =>
                    file.isFolder ? openFolder(file) : toggleSelect(file)
                  }
                  onToggle={() => toggleSelect(file)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <span className="text-xs text-[var(--muted)]">
            {downloading
              ? "Downloading… Cancel anytime"
              : slotHint
                ? slotHint
                : selectedList.length === 0
                  ? remainingSlots <= 0
                    ? `Maximum of ${MAX_ATTACHMENTS} files already attached`
                    : `Select up to ${remainingSlots} file${remainingSlots === 1 ? "" : "s"}`
                  : `${selectedList.length} selected · ${remainingSlots - selectedList.length} slot${remainingSlots - selectedList.length === 1 ? "" : "s"} left`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={requestClose}>
              {downloading ? "Cancel" : "Close"}
            </Button>
            <Button
              onClick={() => void handleConfirm()}
              disabled={
                selectedList.length === 0 ||
                downloading ||
                remainingSlots <= 0
              }
            >
              {downloading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Downloading…
                </span>
              ) : (
                `Select${selectedList.length ? ` (${selectedList.length})` : ""}`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileCard({
  file,
  selected,
  progress,
  onOpen,
  onToggle,
}: {
  file: DriveFileItem;
  selected: boolean;
  progress?: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--surface)] transition-colors",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-muted)]"
          : "border-[var(--border)] hover:bg-[var(--hover-overlay)]",
      )}
    >
      {!file.isFolder && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded border transition-colors",
            selected
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-[var(--border)] bg-[var(--canvas)] text-transparent group-hover:text-[var(--muted)]",
          )}
          aria-label={selected ? "Deselect" : "Select"}
        >
          <CheckIcon className="size-3" />
        </button>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col text-left"
      >
        <div className="flex aspect-[4/3] items-center justify-center bg-[var(--elevated)]">
          <FileThumb file={file} />
        </div>
        <div className="space-y-0.5 px-2.5 py-2">
          <div className="truncate text-xs font-medium text-[var(--text)]">
            {file.name}
          </div>
          <div className="truncate text-[10px] text-[var(--muted-soft)]">
            {fileTypeLabel(file.mimeType)}
            {file.size ? ` · ${formatBytes(file.size)}` : ""}
          </div>
          {typeof progress === "number" && progress < 100 && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--elevated-deep)]">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function FileRow({
  file,
  selected,
  progress,
  onOpen,
  onToggle,
}: {
  file: DriveFileItem;
  selected: boolean;
  progress?: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
        selected
          ? "bg-[var(--accent-muted)]"
          : "hover:bg-[var(--hover-overlay)]",
      )}
    >
      {!file.isFolder ? (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded border",
            selected
              ? "border-[var(--accent)] bg-[var(--accent)] text-white"
              : "border-[var(--border)] text-transparent",
          )}
          aria-label={selected ? "Deselect" : "Select"}
        >
          <CheckIcon className="size-3" />
        </button>
      ) : (
        <span className="size-5 shrink-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--elevated)]">
          <FileThumb file={file} small />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[var(--text)]">{file.name}</div>
          <div className="truncate text-[11px] text-[var(--muted-soft)]">
            {fileTypeLabel(file.mimeType)}
            {file.size ? ` · ${formatBytes(file.size)}` : ""}
            {file.modifiedTime
              ? ` · ${new Date(file.modifiedTime).toLocaleDateString()}`
              : ""}
          </div>
          {typeof progress === "number" && progress < 100 && (
            <div className="mt-1 h-1 max-w-[12rem] overflow-hidden rounded-full bg-[var(--elevated-deep)]">
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function FileThumb({
  file,
  small,
}: {
  file: DriveFileItem;
  small?: boolean;
}) {
  if (file.isFolder) {
    return (
      <FolderIcon
        className={cn(
          "text-[var(--muted)]",
          small ? "size-4" : "size-8",
        )}
      />
    );
  }

  if (file.thumbnailLink) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.thumbnailLink}
        alt=""
        className={cn(
          "object-cover",
          small ? "size-8" : "h-full w-full",
        )}
        referrerPolicy="no-referrer"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  if (file.mimeType.startsWith("image/")) {
    return (
      <ImageIcon
        className={cn("text-[var(--muted)]", small ? "size-4" : "size-8")}
      />
    );
  }

  if (file.iconLink) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={file.iconLink.replace("/16/", "/64/")}
        alt=""
        className={cn(small ? "size-4" : "size-8")}
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <FileIcon
      className={cn("text-[var(--muted)]", small ? "size-4" : "size-8")}
    />
  );
}

function GoogleDriveIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M9.3 2L14.7 2L22 15.5L19.3 20.5L12.7 20.5L9.3 2Z" fill="#0F9D58" />
      <path d="M9.3 2L2 15.5L4.7 20.5L12 7L9.3 2Z" fill="#4285F4" />
      <path d="M14.7 2L9.3 2L2 15.5L7.3 15.5L14.7 2Z" fill="#0F9D58" />
      <path d="M12 7L7.3 15.5L12 15.5L16.7 15.5L12 7Z" fill="#FFC107" />
      <path d="M12 7L16.7 15.5L22 15.5L12 7Z" fill="#FFC107" />
    </svg>
  );
}
