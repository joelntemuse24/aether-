"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  NEW_CHAT_PATH,
  parseThreadIdFromPath,
  stickyCanonicalId,
  threadPath,
  type CanonicalThreadState,
} from "@/lib/thread-url";
import { beginNewChatSession } from "@/lib/local-thread-adapter";

/**
 * Keeps the browser URL and the active conversation in sync.
 * - `/` → new chat
 * - `/c/<id>` → that thread (bookmarkable / refreshable)
 */
export function ThreadUrlSync() {
  const aui = useAui();
  const router = useRouter();
  const pathname = usePathname();
  const urlThreadId = parseThreadIdFromPath(pathname);
  /** Path we just asked the router to navigate to (skip re-applying as URL→state). */
  const pendingPath = useRef<string | null>(null);
  /** Sticky canonical id + the item key it belongs to. */
  const canonicalRef = useRef<CanonicalThreadState>({ key: "", id: null });
  /** Suppress active→URL writes until the pending new-chat switch settles. */
  const pendingNewChat = useRef(false);

  // Select primitives separately — returning a fresh object from the
  // selector re-renders infinitely (useSyncExternalStore contract).
  const itemKey = useAuiState((s) => {
    try {
      return String(s.threadListItem?.id ?? "");
    } catch {
      return "";
    }
  });
  const rawId = useAuiState((s) => {
    try {
      const item = s.threadListItem;
      if (item?.remoteId) return item.remoteId;
      // Brand-new empty chats stay on `/` until they get a remote id.
      if (item?.status === "new") return null;
      return (item?.id as string | undefined) ?? null;
    } catch {
      return null;
    }
  });

  // Resolve the canonical id through the sticky wrapper so transient
  // remoteId drops (cloud refresh) don't flip the URL to `/`.
  const sticky = stickyCanonicalId(canonicalRef.current, itemKey, rawId);
  if (sticky !== canonicalRef.current) {
    canonicalRef.current = sticky;
  }
  const canonicalId = sticky.id;

  // Active thread → URL
  useEffect(() => {
    // A new-chat switch is in flight: hold the URL at `/` until the runtime
    // reports the new (empty) thread, instead of writing the old id back.
    if (pendingNewChat.current) {
      if (urlThreadId === null) {
        pendingNewChat.current = false;
      } else {
        return;
      }
    }
    const desired = canonicalId ? threadPath(canonicalId) : NEW_CHAT_PATH;
    if (pathname === desired) {
      pendingPath.current = null;
      return;
    }
    pendingPath.current = desired;
    router.replace(desired, { scroll: false });
  }, [canonicalId, pathname, router, urlThreadId]);

  // URL → active thread (deep links, back/forward)
  useEffect(() => {
    if (pendingPath.current === pathname) {
      pendingPath.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await aui.threads().getLoadThreadsPromise();
      } catch {
        return;
      }
      if (cancelled) return;

      if (urlThreadId) {
        try {
          aui.threads().switchToThread(urlThreadId);
        } catch {
          if (!cancelled) {
            pendingPath.current = NEW_CHAT_PATH;
            router.replace(NEW_CHAT_PATH, { scroll: false });
          }
        }
        return;
      }

      // Bare `/` from back/forward or explicit navigation → new chat.
      pendingNewChat.current = true;
      aui.threads().switchToNewThread();
      // Drop stale active id so first-send initialize isn't treated as A→B.
      beginNewChatSession();
    })();

    return () => {
      cancelled = true;
    };
  }, [urlThreadId, pathname, aui, router]);

  return null;
}
