/** Conversation URL helpers — `/` is a new chat; `/c/<id>` is a stored thread. */

export const NEW_CHAT_PATH = "/";

export function threadPath(threadId: string): string {
  return `/c/${encodeURIComponent(threadId)}`;
}

export function parseThreadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Read thread id from the current location (client-only). */
export function readThreadIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return parseThreadIdFromPath(window.location.pathname) ?? undefined;
}
