"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  resolveApiKey,
  resolveBaseURL,
  resolveModel,
  saveSettings,
  type AppSettings,
  hasValidKey,
  buildChatHeaders,
} from "@/lib/settings";
import { getModelLabel } from "@/lib/models";

type SettingsContextValue = {
  settings: AppSettings;
  hydrated: boolean;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setSettings: (next: AppSettings) => void;
  activeModel: string;
  activeModelLabel: string;
  hasKey: boolean;
  chatHeaders: Record<string, string>;
  openSettings: boolean;
  setOpenSettings: (open: boolean) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);

  useEffect(() => {
    const loaded = loadSettings();
    setSettingsState(loaded);
    setHydrated(true);
    if (!hasValidKey(loaded)) {
      setOpenSettings(true);
    }
  }, []);

  const setSettings = useCallback((next: AppSettings) => {
    setSettingsState(next);
    saveSettings(next);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      // Keep per-provider keys in sync when editing the active key field
      if (patch.openrouterKey !== undefined && prev.provider === "openrouter") {
        next.apiKey = patch.openrouterKey;
      }
      if (patch.openaiKey !== undefined && prev.provider === "openai") {
        next.apiKey = patch.openaiKey;
      }
      if (patch.anthropicKey !== undefined && prev.provider === "anthropic") {
        next.apiKey = patch.anthropicKey;
      }
      if (patch.customKey !== undefined && prev.provider === "custom") {
        next.apiKey = patch.customKey;
      }
      saveSettings(next);
      return next;
    });
  }, []);

  const activeModel = resolveModel(settings);
  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      hydrated,
      updateSettings,
      setSettings,
      activeModel,
      activeModelLabel: getModelLabel(activeModel),
      hasKey: hasValidKey(settings),
      chatHeaders: buildChatHeaders(settings),
      openSettings,
      setOpenSettings,
    }),
    [
      settings,
      hydrated,
      updateSettings,
      setSettings,
      activeModel,
      openSettings,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function useOptionalSettings() {
  return useContext(SettingsContext);
}

// Re-export helpers for convenience
export { resolveApiKey, resolveBaseURL, resolveModel };
