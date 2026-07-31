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
  canChat,
  buildChatHeaders,
} from "@/lib/settings";
import { getHostedModelLabel } from "@/lib/hosted/catalog";
import { getModelLabel } from "@/lib/models";

export type HostedStatus = {
  available: boolean;
  defaultModel: string;
  models: Array<{
    id: string;
    label: string;
    family: string;
    description?: string;
  }>;
};

type SettingsContextValue = {
  settings: AppSettings;
  hydrated: boolean;
  updateSettings: (patch: Partial<AppSettings>) => void;
  setSettings: (next: AppSettings) => void;
  activeModel: string;
  activeModelLabel: string;
  /** True when the user can send chat (hosted available or BYOK key). */
  hasKey: boolean;
  hostedStatus: HostedStatus | null;
  hostedLoading: boolean;
  chatHeaders: Record<string, string>;
  openSettings: boolean;
  setOpenSettings: (open: boolean) => void;
  /** When true, Settings should bring Connected accounts into view (e.g. ?connect=drive). */
  focusConnectedAccounts: boolean;
  clearFocusConnectedAccounts: () => void;
  openConnectedAccounts: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [focusConnectedAccounts, setFocusConnectedAccounts] = useState(false);
  const [hostedStatus, setHostedStatus] = useState<HostedStatus | null>(null);
  const [hostedLoading, setHostedLoading] = useState(true);

  useEffect(() => {
    const loaded = loadSettings();
    setSettingsState(loaded);
    setHydrated(true);

    let openForConnect = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const connectTarget = params.get("connect");
      if (connectTarget === "drive" || connectTarget === "github") {
        openForConnect = true;
        setFocusConnectedAccounts(true);
        params.delete("connect");
        const next = params.toString();
        const url = next
          ? `${window.location.pathname}?${next}`
          : window.location.pathname;
        window.history.replaceState({}, "", url);
      }
    }

    let cancelled = false;
    setHostedLoading(true);
    fetch("/api/hosted/status")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HostedStatus>;
      })
      .then((status) => {
        if (cancelled) return;
        setHostedStatus(status);
        // Auto-pick default hosted model when needed
        if (
          loaded.accessMode === "hosted" &&
          status.available &&
          status.defaultModel &&
          !loaded.useCustomModel &&
          (!loaded.model ||
            !status.models.some((m) => m.id === loaded.model))
        ) {
          const next = { ...loaded, model: status.defaultModel };
          setSettingsState(next);
          saveSettings(next);
        }
        const chatReady = canChat(
          {
            ...loaded,
            model:
              loaded.accessMode === "hosted" &&
              status.available &&
              status.defaultModel &&
              !loaded.useCustomModel &&
              (!loaded.model ||
                !status.models.some((m) => m.id === loaded.model))
                ? status.defaultModel
                : loaded.model,
          },
          status.available,
        );
        if (openForConnect || !chatReady) {
          setOpenSettings(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHostedStatus({ available: false, defaultModel: "", models: [] });
        // Hosted probe failed — open settings if BYOK isn't ready either
        if (openForConnect || !canChat(loaded, false)) {
          setOpenSettings(true);
        }
      })
      .finally(() => {
        if (!cancelled) setHostedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clearFocusConnectedAccounts = useCallback(() => {
    setFocusConnectedAccounts(false);
  }, []);

  const openConnectedAccounts = useCallback(() => {
    setFocusConnectedAccounts(true);
    setOpenSettings(true);
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
      // When switching into hosted, ensure a sensible default model
      if (patch.accessMode === "hosted" && !next.model.trim()) {
        next.model = hostedStatus?.defaultModel || "claude-sonnet-4";
        next.useCustomModel = false;
      }
      saveSettings(next);
      return next;
    });
  }, [hostedStatus?.defaultModel]);

  const activeModel = resolveModel(settings);
  const hostedAvailable = hostedStatus?.available ?? false;
  const hostedLabel = hostedStatus?.models.find((m) => m.id === activeModel)
    ?.label;
  const activeModelLabel =
    hostedLabel ||
    getHostedModelLabel(activeModel) ||
    getModelLabel(activeModel);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      hydrated,
      updateSettings,
      setSettings,
      activeModel,
      activeModelLabel,
      hasKey: canChat(settings, hostedAvailable),
      hostedStatus,
      hostedLoading,
      chatHeaders: buildChatHeaders(settings),
      openSettings,
      setOpenSettings,
      focusConnectedAccounts,
      clearFocusConnectedAccounts,
      openConnectedAccounts,
    }),
    [
      settings,
      hydrated,
      updateSettings,
      setSettings,
      activeModel,
      activeModelLabel,
      hostedAvailable,
      hostedStatus,
      hostedLoading,
      openSettings,
      focusConnectedAccounts,
      clearFocusConnectedAccounts,
      openConnectedAccounts,
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
