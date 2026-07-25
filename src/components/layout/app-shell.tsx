"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Thread } from "@/components/assistant-ui/thread";
import { Sidebar } from "@/components/layout/sidebar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { DriveBrowserModal } from "@/components/drive/drive-browser-modal";
import { useArtifact } from "@/providers/artifact-provider";
import { useAttachments } from "@/providers/attachments-provider";
import { useDrive } from "@/providers/drive-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Lazy-loaded: pulls in highlight.js + marked only when an artifact is shown.
const ArtifactPanel = dynamic(
  () =>
    import("@/components/layout/artifact-panel").then((m) => m.ArtifactPanel),
  { ssr: false },
);

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const { open: artifactOpen } = useArtifact();
  const { browserOpen, setBrowserOpen } = useDrive();
  const { addAttachments } = useAttachments();
  const [driveErrors, setDriveErrors] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("aether:sidebar-collapsed");
    if (stored === "1") setSidebarCollapsed(true);
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
            className="rounded px-2 py-1 text-[var(--muted)] transition-colors hover:bg-[var(--hover-overlay)]"
          >
            <Label>Menu</Label>
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
          if (attachments.length > 0) addAttachments(attachments);
          if (errors.length > 0) setDriveErrors(errors);
        }}
      />

      {driveErrors.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-[120] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-3 py-2 text-xs text-[var(--error-text)] shadow-none">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              {driveErrors.map((err) => (
                <div key={err}>{err}</div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setDriveErrors([])}
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
