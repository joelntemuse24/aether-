"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { Sidebar } from "@/components/layout/sidebar";
import { ArtifactPanel } from "@/components/layout/artifact-panel";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { useArtifact } from "@/providers/artifact-provider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const { open: artifactOpen } = useArtifact();

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
          <Image src="/logo.jpg" alt="Aether" width={20} height={20} className="rounded object-cover" />
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
    </div>
  );
}
