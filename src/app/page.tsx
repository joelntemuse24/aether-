"use client";

import { SettingsProvider } from "@/providers/settings-provider";
import { RuntimeProvider } from "@/providers/runtime-provider";
import { ArtifactProvider } from "@/providers/artifact-provider";
import { AttachmentsProvider } from "@/providers/attachments-provider";
import { DriveProvider } from "@/providers/drive-provider";
import { AppShell } from "@/components/layout/app-shell";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";

export default function HomePage() {
  return (
    <SettingsProvider>
      <AttachmentsProvider>
        <DriveProvider>
          <RuntimeProvider>
            <ArtifactProvider>
              <KeyboardShortcuts />
              <AppShell />
            </ArtifactProvider>
          </RuntimeProvider>
        </DriveProvider>
      </AttachmentsProvider>
    </SettingsProvider>
  );
}
