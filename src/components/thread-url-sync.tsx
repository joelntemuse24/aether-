"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
  NEW_CHAT_PATH,
  didUrlBecomeNewChat,
  nextUrlSyncLatches,
  parseThreadIdFromPath,
  planActiveThreadToUrl,
  planUrlToThread,
  stickyCanonicalId,
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
  /** Suppress active→URL writes of the old id until the new empty thread is active. */
  const pendingNewChat = useRef(false);
  /** Deep link / refresh / back-forward: hold URL until the runtime matches. */
  const applyingUrlThread = useRef<string | null>(urlThreadId);
  const prevUrlThreadId = useRef<string | null>(urlThreadId);

  // Select primitives separately — returning a fresh object from the
  // selector re-renders infinitely (useSyncExternalStore contract).
  const itemKey = useAuiState((s) => {
    try {
      return String(s.threadListItem?.id ?? "");
    } catch {
      return "";
    }
  });
  const itemIsNew = useAuiState((s) => {
    try {
      return s.threadListItem?.status === "new";
    } catch {
      return false;
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

  // Sidebar / keyboard already call beginNewChatSession — latch immediately
  // so Active→URL cannot write the previous `/c/<id>` back.
  useEffect(() => {
    const onSwitch = (event: Event) => {
      const detail = (event as CustomEvent<{ newChat?: boolean }>).detail;
      if (!detail?.newChat) return;
      pendingNewChat.current = true;
      applyingUrlThread.current = null;
    };
    window.addEventListener("aether:thread-switched", onSwitch);
    return () => window.removeEventListener("aether:thread-switched", onSwitch);
  }, []);

  const urlBecameNewChat = didUrlBecomeNewChat(
    prevUrlThreadId.current,
    urlThreadId,
  );
  prevUrlThreadId.current = urlThreadId;

  const latches = nextUrlSyncLatches({
    urlThreadId,
    canonicalId,
    itemIsNew,
    pendingNewChat: pendingNewChat.current,
    applyingUrlThread: applyingUrlThread.current,
    urlBecameNewChat,
  });
  pendingNewChat.current = latches.pendingNewChat;
  applyingUrlThread.current = latches.applyingUrlThread;

  // Active thread → URL
  useEffect(() => {
    const plan = planActiveThreadToUrl({
      urlThreadId,
      canonicalId,
      itemIsNew,
      pendingNewChat: pendingNewChat.current,
      applyingUrlThread: applyingUrlThread.current,
    });
    if (plan.action === "hold") return;
    const desired = plan.path;
    if (pathname === desired) {
      pendingPath.current = null;
      return;
    }
    pendingPath.current = desired;
    router.replace(desired, { scroll: false });
  }, [canonicalId, itemIsNew, pathname, router, urlThreadId]);

  // URL → active thread (deep links, back/forward)
  useEffect(() => {
    const action = planUrlToThread({
      pathname,
      urlThreadId,
      pendingPath: pendingPath.current,
      pendingNewChat: pendingNewChat.current,
      itemIsNew,
    });
    if (action === "ignore") {
      if (pendingPath.current === pathname) pendingPath.current = null;
      return;
    }

    let cancelled = false;

    void (async () => {
      if (action === "switch-new") {
        pendingNewChat.current = true;
        applyingUrlThread.current = null;
        aui.threads().switchToNewThread();
        beginNewChatSession();
        return;
      }

      applyingUrlThread.current = urlThreadId;
      try {
        await aui.threads().getLoadThreadsPromise();
      } catch {
        return;
      }
      if (cancelled || !urlThreadId) return;

      try {
        aui.threads().switchToThread(urlThreadId);
      } catch {
        if (!cancelled) {
          pendingPath.current = NEW_CHAT_PATH;
          applyingUrlThread.current = null;
          pendingNewChat.current = true;
          router.replace(NEW_CHAT_PATH, { scroll: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [urlThreadId, pathname, aui, router, itemIsNew]);

  return null;
}
