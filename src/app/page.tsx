"use client";

import { SettingsProvider } from "@/providers/settings-provider";
import { RuntimeProvider } from "@/providers/runtime-provider";
import { ArtifactProvider } from "@/providers/artifact-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AttachmentsProvider } from "@/providers/attachments-provider";
import { AppShell } from "@/components/layout/app-shell";

export default function HomePage() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <AttachmentsProvider>
          <RuntimeProvider>
            <ArtifactProvider>
              <AppShell />
            </ArtifactProvider>
          </RuntimeProvider>
        </AttachmentsProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
