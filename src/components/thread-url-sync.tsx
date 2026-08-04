"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  NEW_CHAT_PATH,
  parseThreadIdFromPath,
  threadPath,
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

  const canonicalId = useAuiState((s) => {
    try {
      const item = s.threadListItem;
      if (item.remoteId) return item.remoteId;
      // Brand-new empty chats stay on `/` until they get a remote id.
      if (item.status === "new") return null;
      return item.id;
    } catch {
      return null;
    }
  });

  // Active thread → URL
  useEffect(() => {
    const desired = canonicalId ? threadPath(canonicalId) : NEW_CHAT_PATH;
    if (pathname === desired) {
      pendingPath.current = null;
      return;
    }
    pendingPath.current = desired;
    router.replace(desired, { scroll: false });
  }, [canonicalId, pathname, router]);

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
