/**
 * Client-side GitHub connector helpers (one-click OAuth via server routes).
 */

export type GitHubConnectionState = {
  connected: boolean;
  authenticated: boolean;
  login?: string | null;
  name?: string | null;
  githubConfigured?: boolean;
};

export async function fetchGitHubStatus(): Promise<GitHubConnectionState> {
  const res = await fetch("/api/github/status", { cache: "no-store" });
  if (!res.ok) {
    return { connected: false, authenticated: false };
  }
  return (await res.json()) as GitHubConnectionState;
}

export async function disconnectGitHub(): Promise<void> {
  await fetch("/api/github/disconnect", { method: "POST" });
}

/** Navigate to GitHub OAuth to connect (requires login). */
export function connectGitHub(): void {
  window.location.href = "/api/github/connect";
}
