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
import { useSession } from "next-auth/react";
import {
  connectDrive,
  disconnectDrive,
  fetchDriveStatus,
  type DriveConnectionState,
} from "@/lib/google-drive";

type DriveContextValue = {
  connected: boolean;
  authenticated: boolean;
  email?: string | null;
  googleConfigured: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  connect: () => void;
  disconnect: () => Promise<void>;
  /** Open the custom Drive file browser */
  browserOpen: boolean;
  setBrowserOpen: (open: boolean) => void;
};

const DriveContext = createContext<DriveContextValue | null>(null);

export function DriveProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [state, setState] = useState<DriveConnectionState>({
    connected: false,
    authenticated: false,
  });
  const [loading, setLoading] = useState(true);
  const [browserOpen, setBrowserOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchDriveStatus();
      setState(next);
    } catch {
      setState({ connected: false, authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    void refresh();
  }, [status, refresh]);

  // Handle redirect query params after OAuth
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive_connected") === "1" || params.get("drive_error")) {
      void refresh();
      params.delete("drive_connected");
      params.delete("drive_error");
      const next = params.toString();
      const url = next
        ? `${window.location.pathname}?${next}`
        : window.location.pathname;
      window.history.replaceState({}, "", url);
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await disconnectDrive();
    setState((s) => ({ ...s, connected: false, email: null }));
  }, []);

  const value = useMemo<DriveContextValue>(
    () => ({
      connected: state.connected,
      authenticated: state.authenticated || status === "authenticated",
      email: state.email,
      googleConfigured: Boolean(state.googleConfigured),
      loading,
      refresh,
      connect: connectDrive,
      disconnect,
      browserOpen,
      setBrowserOpen,
    }),
    [state, status, loading, refresh, disconnect, browserOpen],
  );

  return (
    <DriveContext.Provider value={value}>{children}</DriveContext.Provider>
  );
}

export function useDrive() {
  const ctx = useContext(DriveContext);
  if (!ctx) throw new Error("useDrive must be used within DriveProvider");
  return ctx;
}
