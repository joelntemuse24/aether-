"use client";

import Image from "next/image";
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
  SunIcon,
  MoonIcon,
} from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { useTheme } from "@/providers/theme-provider";
import { Label } from "@/components/ui/label";
import type { FC } from "react";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { setOpenSettings } = useSettings();
  const { theme, toggleTheme } = useTheme();

  if (collapsed) {
    return (
      <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-[var(--border)] bg-[var(--elevated)] py-3">
        <Image src="/logo.jpg" alt="Aether" width={32} height={32} className="mb-3 rounded object-cover" />
        <button
          type="button"
          onClick={onToggle}
          className="mb-3 flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftIcon className="size-4" />
        </button>
        <ThreadListPrimitive.New asChild>
          <button
            type="button"
            className="mb-auto flex size-8 items-center justify-center rounded-lg text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
            aria-label="New chat"
            title="New chat"
          >
            <PlusIcon className="size-4" />
          </button>
        </ThreadListPrimitive.New>
        <button
          type="button"
          onClick={() => setOpenSettings(true)}
          className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--elevated)]">
      <div className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded">
            <Image src="/logo.jpg" alt="Aether" width={28} height={28} className="rounded object-cover" />
          </div>
          <span className="font-[family-name:var(--font-sc)] text-[13px] font-medium tracking-[0.08em] text-[var(--text)]">
            Aether
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex size-7 items-center justify-center rounded text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelLeftCloseIcon className="size-3.5" />
        </button>
      </div>

      <div className="px-3 pb-3">
        <ThreadListPrimitive.New asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] transition-colors hover:bg-[var(--hover-overlay)]"
          >
            <PlusIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
            <Label>New conversation</Label>
          </button>
        </ThreadListPrimitive.New>
      </div>

      <div className="px-2 pb-1 pt-0.5">
        <Label>Recent</Label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <ThreadListPrimitive.Root className="flex flex-col gap-0.5">
          <AuiIf condition={(s) => s.threads.threadIds.length === 0}>
            <div className="flex flex-col items-center gap-2 px-2 py-8 text-[var(--muted-soft)]">
              <MessageSquareIcon className="size-5 opacity-40" />
              <Label>No conversations yet</Label>
            </div>
          </AuiIf>
          <ThreadListPrimitive.Items>
            {() => <ThreadListItem />}
          </ThreadListPrimitive.Items>
        </ThreadListPrimitive.Root>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpenSettings(true)}
            className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)]"
          >
            <SettingsIcon className="size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-[var(--text)]">Settings</div>
              <Label>Model · API key</Label>
            </div>
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? <SunIcon className="size-3.5" /> : <MoonIcon className="size-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}

const ThreadListItem: FC = () => {
  const title = useAuiState((s) => s.threadListItem.title || "New chat");

  return (
    <ThreadListItemPrimitive.Root className="group relative flex items-center rounded-md data-[active]:bg-[var(--elevated-deep)] hover:bg-[var(--hover-overlay)]">
      <ThreadListItemPrimitive.Trigger className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-[13px] text-[var(--text)]">
        <span className="truncate">{title}</span>
      </ThreadListItemPrimitive.Trigger>

      <ThreadListItemPrimitive.Delete asChild>
        <button
          type="button"
          className="me-1 flex size-6 shrink-0 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--hover-overlay)] group-hover:opacity-100 group-data-[active]:opacity-100"
          aria-label="Delete conversation"
          title="Delete"
        >
          <TrashIcon className="size-3" />
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
