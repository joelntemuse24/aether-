"use client";

import { SettingsProvider } from "@/providers/settings-provider";
import { RuntimeProvider } from "@/providers/runtime-provider";
import { ArtifactProvider } from "@/providers/artifact-provider";
import { AppShell } from "@/components/layout/app-shell";

export default function HomePage() {
  return (
    <SettingsProvider>
      <RuntimeProvider>
        <ArtifactProvider>
          <AppShell />
        </ArtifactProvider>
      </RuntimeProvider>
    </SettingsProvider>
  );
}
