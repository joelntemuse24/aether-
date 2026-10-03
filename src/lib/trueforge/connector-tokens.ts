/** Google access tokens last about an hour. Refresh before a tool call uses a stale one. */
export async function freshDriveAccessToken(input: {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  now?: number;
  refresh: (refreshToken: string) => Promise<{ accessToken: string; expiresAt: number } | null>;
}): Promise<string | undefined> {
  const now = input.now ?? Date.now();
  const stillValid =
    !!input.accessToken && (input.expiresAt == null || now < input.expiresAt - 60_000);
  if (stillValid) return input.accessToken;
  if (!input.refreshToken) return input.accessToken;
  const next = await input.refresh(input.refreshToken);
  if (next?.accessToken) return next.accessToken;
  return input.expiresAt != null && now >= input.expiresAt - 60_000 ? undefined : input.accessToken;
}

/**
 * GitHub OAuth App tokens are long-lived. Prefer a cookie read when this
 * request has one; otherwise keep the token sealed in the tool context.
 */
export async function freshGitHubAccessToken(input: {
  userId?: string | null;
  accessToken?: string;
  read: (userId: string) => Promise<{ accessToken: string } | null>;
}): Promise<string | undefined> {
  if (input.userId) {
    try {
      const live = await input.read(input.userId);
      if (live?.accessToken) return live.accessToken;
    } catch {
      // Sidecar tool calls do not carry the browser cookie.
    }
  }
  return input.accessToken;
}
