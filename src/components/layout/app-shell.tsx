"use client";

import Image from "next/image";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { PanelLeftIcon } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import { Sidebar } from "@/components/layout/sidebar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { DriveBrowserModal } from "@/components/drive/drive-browser-modal";
import { SyncLocalChatsBanner } from "@/components/sync-local-chats-banner";
import { SyncLocalMemory } from "@/components/sync-local-memory";
import { useArtifact } from "@/providers/artifact-provider";
import { useAttachments } from "@/providers/attachments-provider";
import { useDrive } from "@/providers/drive-provider";
import { cn } from "@/lib/utils";

// Lazy-loaded: pulls in highlight.js + marked only when an artifact is shown.
const ArtifactPanel = dynamic(
  () =>
    import("@/components/layout/artifact-panel").then((m) => m.ArtifactPanel),
  { ssr: false },
);

function pushNotices(
  setNotices: Dispatch<SetStateAction<string[]>>,
  incoming: string | string[],
) {
  const list = (Array.isArray(incoming) ? incoming : [incoming]).filter(
    (m): m is string => typeof m === "string" && m.trim().length > 0,
  );
  if (list.length === 0) return;
  setNotices((prev) => {
    const next = [...prev];
    for (const message of list) {
      if (!next.includes(message)) next.push(message);
    }
    return next;
  });
}

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const { open: artifactOpen } = useArtifact();
  const { browserOpen, setBrowserOpen } = useDrive();
  const { addAttachments } = useAttachments();
  const [notices, setNotices] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("aether:sidebar-collapsed");
    if (stored === "1") setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    const onDriveError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const message =
        typeof detail === "string" && detail
          ? `Google Drive: ${detail}`
          : "Google Drive connection failed.";
      pushNotices(setNotices, message);
    };
    const onGitHubError = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const message =
        typeof detail === "string" && detail
          ? `GitHub: ${detail}`
          : "GitHub connection failed.";
      pushNotices(setNotices, message);
    };
    const onNotice = (event: Event) => {
      const detail = (event as CustomEvent<string | string[]>).detail;
      pushNotices(setNotices, detail);
    };
    window.addEventListener("aether:drive-error", onDriveError);
    window.addEventListener("aether:github-error", onGitHubError);
    window.addEventListener("aether:notice", onNotice);
    return () => {
      window.removeEventListener("aether:drive-error", onDriveError);
      window.removeEventListener("aether:github-error", onGitHubError);
      window.removeEventListener("aether:notice", onNotice);
    };
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("aether:sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--canvas)] text-[var(--text)]">
      {/* Desktop sidebar */}
      <div className="hidden h-full md:flex">
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileSidebar && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-[var(--overlay)]"
            onClick={() => setMobileSidebar(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 z-10 w-[248px] shadow-none">
            <Sidebar
              collapsed={false}
              onToggle={() => setMobileSidebar(false)}
            />
          </div>
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebar(true)}
            className="flex size-9 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            aria-label="Open menu"
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <Image src="/logo.jpg" alt="Aether" width={20} height={20} className="rounded-full object-cover" />
          <span className="font-[family-name:var(--font-sc)] text-[13px] tracking-[0.08em] text-[var(--text)]">Aether</span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              "min-w-0 flex-1",
              artifactOpen && "hidden lg:block",
            )}
          >
            <Thread />
          </div>
          <ArtifactPanel />
        </div>
      </main>

      <SettingsDialog />

      <DriveBrowserModal
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={(attachments, errors) => {
          const capErrors =
            attachments.length > 0 ? addAttachments(attachments) : [];
          pushNotices(setNotices, [...errors, ...capErrors]);
        }}
      />

      <SyncLocalChatsBanner />
      <SyncLocalMemory />

      {notices.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-[120] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-none backdrop-blur-md">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              {notices.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setNotices([])}
              className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
