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
  connectGitHub,
  disconnectGitHub,
  fetchGitHubStatus,
  type GitHubConnectionState,
} from "@/lib/github";

type GitHubContextValue = {
  connected: boolean;
  authenticated: boolean;
  login?: string | null;
  name?: string | null;
  githubConfigured: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  connect: () => void;
  disconnect: () => Promise<void>;
};

const GitHubContext = createContext<GitHubContextValue | null>(null);

export function GitHubProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [state, setState] = useState<GitHubConnectionState>({
    connected: false,
    authenticated: false,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchGitHubStatus();
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("github_connected") === "1";
    const githubError = params.get("github_error");
    if (connected || githubError) {
      void refresh();
      if (githubError) {
        window.dispatchEvent(
          new CustomEvent("aether:github-error", {
            detail: decodeURIComponent(githubError),
          }),
        );
      }
      params.delete("github_connected");
      params.delete("github_error");
      const next = params.toString();
      const url = next
        ? `${window.location.pathname}?${next}`
        : window.location.pathname;
      window.history.replaceState({}, "", url);
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await disconnectGitHub();
    setState((s) => ({ ...s, connected: false, login: null, name: null }));
  }, []);

  const value = useMemo<GitHubContextValue>(
    () => ({
      connected: state.connected,
      authenticated: state.authenticated || status === "authenticated",
      login: state.login,
      name: state.name,
      githubConfigured: Boolean(state.githubConfigured),
      loading,
      refresh,
      connect: connectGitHub,
      disconnect,
    }),
    [state, status, loading, refresh, disconnect],
  );

  return (
    <GitHubContext.Provider value={value}>{children}</GitHubContext.Provider>
  );
}

export function useGitHub() {
  const ctx = useContext(GitHubContext);
  if (!ctx) throw new Error("useGitHub must be used within GitHubProvider");
  return ctx;
}
