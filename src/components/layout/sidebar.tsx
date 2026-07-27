"use client";

import Image from "next/image";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FC,
} from "react";
import {
  AuiIf,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
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
  LogOutIcon,
  LogInIcon,
  SearchIcon,
  PencilIcon,
} from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { useTheme } from "@/providers/theme-provider";
import { useSession, signOut } from "@/providers/session-provider";
import { Label } from "@/components/ui/label";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

const ThreadSearchContext = createContext("");

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { setOpenSettings } = useSettings();
  const { theme, toggleTheme } = useTheme();
  const { data: session, status } = useSession();
  const user = session?.user;
  const isAuthenticated = status === "authenticated" && !!user;
  const isLoadingSession = status === "loading";
  const [query, setQuery] = useState("");

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-12 shrink-0 cursor-e-resize flex-col items-center border-r border-[var(--border)] bg-[var(--elevated)] py-3 transition-colors hover:bg-[var(--elevated-deep)]"
        onClick={onToggle}
        title="Click to expand sidebar"
      >
        <Image
          src="/logo.jpg"
          alt="Aether"
          width={32}
          height={32}
          className="mb-3 rounded-full object-cover"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="mb-3 flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftIcon className="size-4" />
        </button>
        <ThreadListPrimitive.New asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
            aria-label="New chat"
            title="New chat (⌘N)"
          >
            <PlusIcon className="size-4" />
          </button>
        </ThreadListPrimitive.New>
        <div className="min-h-4 w-full flex-1" aria-hidden />
        {isAuthenticated ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void signOut({ callbackUrl: "/" });
            }}
            className="mb-2 flex size-8 items-center justify-center overflow-hidden rounded-full text-[var(--muted)] transition-colors hover:ring-2 hover:ring-[var(--border)]"
            aria-label="Sign out"
            title={`Sign out${user?.email ? ` (${user.email})` : ""}`}
          >
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="size-7 rounded-full object-cover"
              />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-full bg-[var(--elevated-deep)] text-[11px] font-medium text-[var(--muted)]">
                {(user?.email || user?.name || "?")[0]?.toUpperCase()}
              </span>
            )}
          </button>
        ) : !isLoadingSession ? (
          <Link
            href="/auth/signin"
            onClick={(e) => e.stopPropagation()}
            className="mb-2 flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Sign in"
            title="Sign in"
          >
            <LogInIcon className="size-4" />
          </Link>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenSettings(true);
          }}
          className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <SettingsIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleTheme();
          }}
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
            <Image src="/logo.jpg" alt="Aether" width={28} height={28} className="rounded-full object-cover" />
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

      <div className="px-3 pb-2">
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

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-soft)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-2 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)] focus:border-[var(--accent)]/35"
            aria-label="Search conversations"
          />
        </div>
      </div>

      <div className="px-2 pb-1 pt-0.5">
        <Label>Recent</Label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <ThreadSearchContext.Provider value={query.trim().toLowerCase()}>
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
        </ThreadSearchContext.Provider>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        {isLoadingSession ? (
          <div className="mb-2 h-10 animate-pulse rounded-md bg-[var(--hover-overlay)]" />
        ) : isAuthenticated ? (
          <div className="mb-2 flex items-center gap-2.5 rounded-md px-2 py-1.5">
            {user?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                className="size-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--elevated-deep)] text-xs font-medium text-[var(--muted)]">
                {(user?.email || user?.name || "?")[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-[var(--text)]">
                {user?.name || "Signed in"}
              </div>
              {user?.email && (
                <div className="truncate text-[10px] text-[var(--muted-soft)]">
                  {user.email}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/" })}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOutIcon className="size-3.5" />
            </button>
          </div>
        ) : (
          <Link
            href="/auth/signin"
            className="mb-2 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          >
            <LogInIcon className="size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-[var(--text)]">Sign in</div>
              <Label>Drive · account</Label>
            </div>
          </Link>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpenSettings(true)}
            className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)]"
          >
            <SettingsIcon className="size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-[var(--text)]">Settings</div>
              <Label>Voice · model · key</Label>
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
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title || "New chat");
  const query = useContext(ThreadSearchContext);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) setDraft(title);
  }, [title, renaming]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (query && !title.toLowerCase().includes(query)) {
    return null;
  }

  const commit = () => {
    const next = draft.trim();
    setRenaming(false);
    if (!next || next === title) return;
    try {
      aui.threadListItem().rename(next);
    } catch {
      setDraft(title);
    }
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1 rounded-md bg-[var(--elevated-deep)] px-1.5 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(title);
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[12px] text-[var(--text)] outline-none"
          aria-label="Rename conversation"
          maxLength={80}
        />
      </div>
    );
  }

  return (
    <ThreadListItemPrimitive.Root className="group relative flex items-center rounded-md data-[active]:bg-[var(--elevated-deep)] hover:bg-[var(--hover-overlay)]">
      <ThreadListItemPrimitive.Trigger className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-[13px] text-[var(--text)]">
        <span className="truncate">{title}</span>
      </ThreadListItemPrimitive.Trigger>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setRenaming(true);
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--hover-overlay)] group-hover:opacity-100 group-data-[active]:opacity-100 max-md:opacity-100"
        aria-label="Rename conversation"
        title="Rename"
      >
        <PencilIcon className="size-3" />
      </button>

      <ThreadListItemPrimitive.Delete asChild>
        <button
          type="button"
          className="me-1 flex size-6 shrink-0 items-center justify-center rounded text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--hover-overlay)] group-hover:opacity-100 group-data-[active]:opacity-100 max-md:opacity-100"
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
