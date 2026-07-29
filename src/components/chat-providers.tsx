"use client";

import type { ReactNode } from "react";
import { SettingsProvider } from "@/providers/settings-provider";
import { RuntimeProvider } from "@/providers/runtime-provider";
import { ArtifactProvider } from "@/providers/artifact-provider";
import { AttachmentsProvider } from "@/providers/attachments-provider";
import { DriveProvider } from "@/providers/drive-provider";
import { AppShell } from "@/components/layout/app-shell";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { ThreadUrlSync } from "@/components/thread-url-sync";
import { HarnessProvider } from "@/providers/harness-provider";

/** Shared provider tree for `/` and `/c/[threadId]`. */
export function ChatProviders({ children }: { children?: ReactNode }) {
  return (
    <SettingsProvider>
      <AttachmentsProvider>
        <DriveProvider>
          <HarnessProvider>
            <RuntimeProvider>
              <ThreadUrlSync />
              <ArtifactProvider>
                <KeyboardShortcuts />
                <AppShell />
                {children}
              </ArtifactProvider>
            </RuntimeProvider>
          </HarnessProvider>
        </DriveProvider>
      </AttachmentsProvider>
    </SettingsProvider>
  );
}
