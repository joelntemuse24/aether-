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
  type ReactNode,
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
  LogInIcon,
  SearchIcon,
  PencilIcon,
  FolderIcon,
  FileTextIcon,
  BookOpenIcon,
  WrenchIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSettings } from "@/providers/settings-provider";
import { useTheme } from "@/providers/theme-provider";
import { listLocalThreads, beginNewChatSession } from "@/lib/local-thread-adapter";
import { useSession, signOut } from "@/providers/session-provider";
import { useProjects } from "@/providers/projects-provider";
import { useArtifact } from "@/providers/artifact-provider";
import { useVault } from "@/providers/vault-provider";
import {
  FloatingVault,
  VaultSidebar,
} from "@/components/layout/vault-sidebar";
import { Label } from "@/components/ui/label";
import { NEW_CHAT_PATH } from "@/lib/thread-url";
import { cn } from "@/lib/utils";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

const ThreadSearchContext = createContext("");

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { setOpenSettings } = useSettings();
  const { theme, toggleTheme } = useTheme();
  const { data: session, status } = useSession();
  const { projects } = useProjects();
  const { saved, savedCloud, openSavedById, refreshSaved } = useArtifact();
  const vault = useVault();
  const router = useRouter();
  const user = session?.user;
  const isAuthenticated = status === "authenticated" && !!user;
  const isLoadingSession = status === "loading";
  const [query, setQuery] = useState("");
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [artifactsExpanded, setArtifactsExpanded] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && savedCloud) void refreshSaved();
  }, [status, savedCloud, refreshSaved]);

  const goNewChat = () => {
    beginNewChatSession();
    router.push(NEW_CHAT_PATH);
  };

  const openVault = () => {
    vault.openVault({
      expandSidebar: collapsed ? onToggle : undefined,
    });
  };

  if (vault.vaultOpen && !collapsed) {
    return (
      <>
        <VaultSidebar
          notes={vault.notes}
          activeNoteId={vault.activeNoteId}
          title={vault.title}
          content={vault.content}
          width={vault.width}
          cloud={vault.cloud}
          onTitleChange={vault.setTitle}
          onContentChange={vault.setContent}
          onWidthChange={vault.setWidth}
          onNew={() => vault.beginNote()}
          onSelect={(note) => vault.beginNote(note)}
          onSave={() => void vault.saveNote()}
          onDelete={(id) => void vault.deleteNote(id)}
          onClose={() => vault.setVaultOpen(false)}
          onDetach={(point) => {
            vault.setDetachPoint(point);
            vault.setVaultOpen(false);
            vault.setVaultFloating(true);
          }}
        />
        {vault.vaultFloating && (
          <FloatingVault
            title={vault.title}
            content={vault.content}
            initialPosition={vault.detachPoint}
            onTitleChange={vault.setTitle}
            onContentChange={vault.setContent}
            onSave={() => void vault.saveNote()}
            onDock={() => {
              vault.setVaultFloating(false);
              vault.setVaultOpen(true);
            }}
            onClose={() => {
              vault.setVaultFloating(false);
              vault.setDetachPoint(null);
            }}
          />
        )}
      </>
    );
  }

  if (collapsed) {
    return (
      <>
        <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--canvas)] py-3">
          <button
            type="button"
            onClick={onToggle}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <ThreadListPrimitive.New asChild>
            <button
              type="button"
              onClick={goNewChat}
              className="flex size-8 items-center justify-center rounded-lg text-[var(--accent)] transition-colors hover:bg-[var(--accent-muted)]"
              aria-label="New chat"
              title="New chat (⌘N)"
            >
              <PlusIcon className="size-4" />
            </button>
          </ThreadListPrimitive.New>
          <button
            type="button"
            onClick={() => setProjectsExpanded(true)}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Projects"
            title="Projects"
          >
            <WrenchIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (saved[0]) void openSavedById(saved[0].id);
              else setArtifactsExpanded(true);
            }}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Artifacts"
            title="Artifacts"
          >
            <FileTextIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={openVault}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Vault"
            title="Vault"
          >
            <BookOpenIcon className="size-4" />
          </button>
          <div className="min-h-4 w-full flex-1" aria-hidden />
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/" })}
              className="mb-1 flex size-7 items-center justify-center overflow-hidden rounded-full text-[11px] font-medium text-[var(--text)]"
              style={{ background: "var(--elevated-deep)" }}
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
                (user?.email || user?.name || "?")[0]?.toUpperCase()
              )}
            </button>
          ) : !isLoadingSession ? (
            <Link
              href="/auth/signin"
              className="mb-1 flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Sign in"
              title="Sign in"
            >
              <LogInIcon className="size-4" />
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setOpenSettings(true)}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Preferences"
            title="Preferences (⌘,)"
          >
            <SettingsIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex size-8 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Cycle theme"
            title={
              theme === "dark"
                ? "Switch to parchment"
                : theme === "light"
                  ? "Switch to white"
                  : "Switch to dark"
            }
          >
            {theme === "dark" ? (
              <SunIcon className="size-4" />
            ) : (
              <MoonIcon className="size-4" />
            )}
          </button>
        </aside>
        {vault.vaultFloating && (
          <FloatingVault
            title={vault.title}
            content={vault.content}
            initialPosition={vault.detachPoint}
            onTitleChange={vault.setTitle}
            onContentChange={vault.setContent}
            onSave={() => void vault.saveNote()}
            onDock={() => {
              vault.setVaultFloating(false);
              vault.setVaultOpen(true);
            }}
            onClose={() => {
              vault.setVaultFloating(false);
              vault.setDetachPoint(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <aside className="flex h-full w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--canvas)]">
        <div className="flex items-center justify-between px-3 py-3">
          <div className="flex items-center gap-2">
            <Image
              src="/logo.jpg"
              alt="Aether"
              width={18}
              height={18}
              className="rounded-full object-cover"
            />
            <span className="font-[family-name:var(--font-sc)] text-[13px] tracking-[0.08em] text-[var(--text)]">
              Aether
            </span>
          </div>
          <button
            type="button"
            onClick={onToggle}
            className="flex size-7 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
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
              onClick={goNewChat}
              className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)]"
            >
              <PlusIcon className="size-3.5 shrink-0 text-[var(--accent)]" />
              New conversation
            </button>
          </ThreadListPrimitive.New>
        </div>

        <div className="flex flex-col gap-1 px-2 pb-3">
          <SidebarNavItem
            icon={<WrenchIcon className="size-3.5" />}
            label="Projects"
            meta={
              isAuthenticated && projects.length > 0
                ? String(projects.length)
                : undefined
            }
            onClick={() => setProjectsExpanded((v) => !v)}
          />
          {projectsExpanded && <ProjectsSection />}
          <SidebarNavItem
            icon={<FileTextIcon className="size-3.5" />}
            label="Artifacts"
            meta={
              isAuthenticated && savedCloud && saved.length > 0
                ? String(saved.length)
                : undefined
            }
            onClick={() => setArtifactsExpanded((v) => !v)}
          />
          {artifactsExpanded && <SavedArtifactsSection />}
          <SidebarNavItem
            icon={<BookOpenIcon className="size-3.5" />}
            label="Vault"
            meta={
              vault.notes.length > 0
                ? String(vault.notes.length)
                : vault.cloud
                  ? "Synced"
                  : "Notes"
            }
            onClick={openVault}
          />
        </div>

        <div className="px-2 pb-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-soft)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1.5 pl-8 pr-3 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)]"
              aria-label="Search conversations"
            />
          </div>
        </div>

        <div className="mb-1 px-3 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-soft)]">
          Recent
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <ThreadSearchContext.Provider value={query.trim().toLowerCase()}>
            <ThreadListPrimitive.Root className="flex flex-col gap-0.5">
              <AuiIf condition={(s) => s.threads.threadIds.length === 0}>
                <div className="flex flex-col items-center gap-2 px-2 py-8 text-[var(--muted-soft)]">
                  <MessageSquareIcon className="size-5 opacity-40" />
                  <span className="text-[11px]">No conversations yet</span>
                </div>
              </AuiIf>
              <ThreadListPrimitive.Items>
                {() => <ThreadListItem />}
              </ThreadListPrimitive.Items>
              <ThreadSearchEmpty />
            </ThreadListPrimitive.Root>
          </ThreadSearchContext.Provider>
        </div>

        <div className="border-t border-[var(--border)] p-2">
          <div className="flex items-center gap-1">
            {isLoadingSession ? (
              <div className="h-7 w-7 animate-pulse rounded-full bg-[var(--hover-overlay)]" />
            ) : isAuthenticated ? (
              <button
                type="button"
                onClick={() => void signOut({ callbackUrl: "/" })}
                className="ml-1 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-medium text-[var(--text)]"
                style={{ background: "var(--elevated-deep)" }}
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
                  (user?.email || user?.name || "?")[0]?.toUpperCase()
                )}
              </button>
            ) : (
              <Link
                href="/auth/signin"
                className="ml-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--hover-overlay)]"
                aria-label="Sign in"
                title="Sign in"
              >
                <LogInIcon className="size-3.5" />
              </Link>
            )}
            <button
              type="button"
              onClick={() => setOpenSettings(true)}
              className="flex flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)]"
            >
              <SettingsIcon className="size-3.5 shrink-0" />
              <span className="text-[12px] text-[var(--text)]">Preferences</span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Cycle theme"
              title={
                theme === "dark"
                  ? "Switch to parchment"
                  : theme === "light"
                    ? "Switch to white"
                    : "Switch to dark"
              }
            >
              {theme === "dark" ? (
                <SunIcon className="size-3.5" />
              ) : (
                <MoonIcon className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </aside>
      {vault.vaultFloating && (
        <FloatingVault
          title={vault.title}
          content={vault.content}
          initialPosition={vault.detachPoint}
          onTitleChange={vault.setTitle}
          onContentChange={vault.setContent}
          onSave={() => void vault.saveNote()}
          onDock={() => {
            vault.setVaultFloating(false);
            vault.setVaultOpen(true);
          }}
          onClose={() => {
            vault.setVaultFloating(false);
            vault.setDetachPoint(null);
          }}
        />
      )}
    </>
  );
}

function SidebarNavItem({
  icon,
  label,
  meta,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)]"
    >
      <span>{icon}</span>
      <span className="min-w-0 flex-1 text-[12px]">{label}</span>
      {meta ? (
        <span className="text-[10px] text-[var(--muted-soft)]">{meta}</span>
      ) : null}
    </button>
  );
}

/** Compact project picker for cloud users — appears above Recent chats. */
function ProjectsSection() {
  const {
    projects,
    activeProjectId,
    setActiveProjectId,
    activeProject,
    create,
    update,
    remove,
    cloud,
  } = useProjects();
  const { status } = useSession();

  if (status !== "authenticated" || !cloud) return null;

  return (
    <div className="px-3 pb-2">
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <Label>Projects</Label>
        <button
          type="button"
          onClick={() => {
            const title = window.prompt("Project name");
            if (!title?.trim()) return;
            void create(title.trim());
          }}
          className="flex size-6 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
          aria-label="New project"
          title="New project"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto">
        <button
          type="button"
          onClick={() => setActiveProjectId(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
            !activeProjectId
              ? "bg-[var(--elevated-deep)] text-[var(--text)]"
              : "text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]",
          )}
        >
          No project
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveProjectId(p.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors",
              activeProjectId === p.id
                ? "bg-[var(--elevated-deep)] text-[var(--text)]"
                : "text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]",
            )}
            title={
              p.instructions
                ? `${p.title} — binds to this chat\n${p.instructions}`
                : `${p.title} — binds to this chat`
            }
          >
            <FolderIcon className="size-3 shrink-0 opacity-70" />
            <span className="truncate">{p.title}</span>
          </button>
        ))}
      </div>
      {activeProject && (
        <div className="mt-1.5 space-y-1">
          <p className="px-0.5 text-[10px] leading-snug text-[var(--muted-soft)]">
            Bound to this conversation
          </p>
          <div className="flex gap-1 px-0.5">
            <button
              type="button"
              onClick={() => {
                const next = window.prompt(
                  "Project instructions (injected into chat)",
                  activeProject.instructions ?? "",
                );
                if (next === null) return;
                void update(activeProject.id, {
                  instructions: next.trim() || null,
                });
              }}
              className="flex-1 rounded-md px-2 py-1 text-left text-[11px] text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            >
              {activeProject.instructions?.trim()
                ? "Edit instructions"
                : "Add instructions"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Delete project “${activeProject.title}”?`)) {
                  return;
                }
                void remove(activeProject.id);
              }}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
              aria-label="Delete project"
              title="Delete project"
            >
              <TrashIcon className="size-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Cloud-saved artifacts — open by id into the panel. */
function SavedArtifactsSection() {
  const { saved, savedCloud, openSavedById, refreshSaved } = useArtifact();
  const { status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && savedCloud) void refreshSaved();
  }, [status, savedCloud, refreshSaved]);

  if (status !== "authenticated" || !savedCloud || saved.length === 0) {
    return null;
  }

  return (
    <div className="px-3 pb-2">
      <div className="mb-1.5 px-0.5">
        <Label>Saved artifacts</Label>
      </div>
      <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
        {saved.slice(0, 12).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => void openSavedById(a.id)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            title={a.title}
          >
            <FileTextIcon className="size-3 shrink-0 opacity-70" />
            <span className="truncate">{a.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ThreadSearchEmpty: FC = () => {
  const query = useContext(ThreadSearchContext);
  const threadCount = useAuiState((s) => s.threads.threadIds.length);
  if (!query || threadCount === 0) return null;

  const hasMatch = listLocalThreads().some((t) =>
    (t.title || "New chat").toLowerCase().includes(query),
  );
  if (hasMatch) return null;

  return (
    <div className="flex flex-col items-center gap-2 px-2 py-8 text-[var(--muted-soft)]">
      <SearchIcon className="size-5 opacity-40" />
      <span className="text-[11px]">No matches</span>
    </div>
  );
};

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
