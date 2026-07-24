"use client";

import { SettingsProvider } from "@/providers/settings-provider";
import { RuntimeProvider } from "@/providers/runtime-provider";
import { ArtifactProvider } from "@/providers/artifact-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AppShell } from "@/components/layout/app-shell";

export default function HomePage() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <RuntimeProvider>
          <ArtifactProvider>
            <AppShell />
          </ArtifactProvider>
        </RuntimeProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
