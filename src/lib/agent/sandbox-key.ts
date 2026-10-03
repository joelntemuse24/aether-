/**
 * Sandbox directory names. A missing user or conversation does not share a folder.
 */

import { createHash } from "node:crypto";

const PART_MAX = 64;

function directoryPart(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
  if (cleaned.length > 0 && cleaned === trimmed) return cleaned.slice(0, PART_MAX);
  const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
  const prefix = cleaned.slice(0, 24);
  return prefix ? `${prefix}-${digest}` : digest;
}

/** `user--conversation`, or null when either id cannot name its own directory. */
export function sandboxDirectoryKey(userId: string, conversationId: string): string | null {
  const user = directoryPart(userId);
  const conversation = directoryPart(conversationId);
  if (!user || !conversation) return null;
  return `${user}--${conversation}`;
}

/**
 * Identity for one native turn. Guests already have a cookie id.
 * A missing conversation id is minted for this turn so it does not join another guest.
 */
export function nativeSandboxIdentity(input: {
  userId: string | null;
  guestId: string;
  conversationId: string | null;
}): { userId: string; conversationId: string } | null {
  const userId = (input.userId || input.guestId).trim();
  if (!userId) return null;
  const conversationId = input.conversationId?.trim() || `turn-${crypto.randomUUID()}`;
  if (!sandboxDirectoryKey(userId, conversationId)) return null;
  return { userId, conversationId };
}
