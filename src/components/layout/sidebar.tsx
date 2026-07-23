"use client";

import {
  AuiIf,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import type { FC } from "react";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { setOpenSettings, activeModelLabel, hasKey } = useSettings();

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--elevated)] py-3">
        <button
          type="button"
          onClick={onToggle}
          className="mb-3 flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated-deep)] hover:text-[var(--text)]"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftIcon className="size-4" />
        </button>
        <ThreadListPrimitive.New asChild>
          <button
            type="button"
            className="mb-auto flex size-8 items-center justify-center rounded-lg text-[var(--accent)] hover:bg-[var(--accent-muted)]"
            aria-label="New chat"
            title="New chat"
          >
            <PlusIcon className="size-4" />
          </button>
        </ThreadListPrimitive.New>
        <button
          type="button"
          onClick={() => setOpenSettings(true)}
          className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated-deep)] hover:text-[var(--text)]"
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--elevated)]">
      <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-muted)] text-[var(--accent)]">
            <span className="text-sm font-semibold leading-none">A</span>
          </div>
          <span className="truncate text-sm font-semibold tracking-tight text-[var(--text)]">
            Aether
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--elevated-deep)] hover:text-[var(--text)]"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelLeftCloseIcon className="size-4" />
        </button>
      </div>

      <div className="px-2 pb-2">
        <ThreadListPrimitive.New asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:bg-[var(--canvas)]"
          >
            <PlusIcon className="size-4 text-[var(--accent)]" />
            New chat
          </button>
        </ThreadListPrimitive.New>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <ThreadListPrimitive.Root className="flex flex-col gap-0.5">
          <AuiIf condition={(s) => s.threads.threadIds.length === 0}>
            <div className="px-2.5 py-6 text-center text-xs text-[var(--muted-soft)]">
              <MessageSquareIcon className="mx-auto mb-2 size-5 opacity-50" />
              No conversations yet
            </div>
          </AuiIf>
          <ThreadListPrimitive.Items>
            {() => <ThreadListItem />}
          </ThreadListPrimitive.Items>
        </ThreadListPrimitive.Root>
      </div>

      <div className="border-t border-[var(--border)] p-2">
        <button
          type="button"
          onClick={() => setOpenSettings(true)}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--elevated-deep)] hover:text-[var(--text)]"
        >
          <SettingsIcon className="size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-[var(--text)]">
              Settings
            </div>
            <div className="truncate text-[11px] text-[var(--muted-soft)]">
              {hasKey ? activeModelLabel : "Add API key"}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}

const ThreadListItem: FC = () => {
  const title = useAuiState((s) => s.threadListItem.title || "New chat");

  return (
    <ThreadListItemPrimitive.Root className="group relative flex items-center rounded-xl data-[active]:bg-[var(--elevated-deep)] hover:bg-[var(--elevated-deep)]/70">
      <ThreadListItemPrimitive.Trigger className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm text-[var(--text)]">
        <span className="truncate">{title}</span>
      </ThreadListItemPrimitive.Trigger>

      <ThreadListItemPrimitive.Delete asChild>
        <button
          type="button"
          className="me-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--canvas)] hover:text-red-700 group-hover:opacity-100 group-data-[active]:opacity-100"
          aria-label="Delete conversation"
          title="Delete"
        >
          <TrashIcon className="size-3.5" />
        </button>
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
};

/** Mobile overlay toggle button when sidebar is closed */
export function MobileSidebarToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute left-3 top-3 z-20 flex size-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] md:hidden"
      aria-label="Open sidebar"
    >
      <PanelLeftIcon className="size-4" />
    </button>
  );
}
