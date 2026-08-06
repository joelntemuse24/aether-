"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/providers/session-provider";
import {
  clearAllLocalConversations,
  exportLocalConversationsForMigrate,
} from "@/lib/local-thread-adapter";
import {
  cloudMigrate,
  fetchCloudStatus,
  invalidateCloudStatus,
} from "@/lib/conversations/cloud-client";

const DISMISS_KEY = "aether:migrate-dismissed";

/**
 * After sign-in, offer to upload browser-local chats into cloud history —
 * Claude/ChatGPT-class continuity across devices.
 */
export function SyncLocalChatsBanner() {
  const { status } = useSession();
  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      setVisible(false);
      invalidateCloudStatus();
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") return;
        invalidateCloudStatus();
        const cloud = await fetchCloudStatus(true);
        if (cancelled || !cloud.cloud) return;
        const local = exportLocalConversationsForMigrate();
        if (local.length === 0) return;
        setPendingCount(local.length);
        setVisible(true);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  if (!visible || pendingCount <= 0) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const sync = async () => {
    setBusy(true);
    try {
      const items = exportLocalConversationsForMigrate();
      const result = await cloudMigrate(items);
      clearAllLocalConversations();
      invalidateCloudStatus();
      window.dispatchEvent(
        new CustomEvent("aether:notice", {
          detail: `Synced ${result.imported} chat${result.imported === 1 ? "" : "s"} to your account${result.skipped ? ` (${result.skipped} already there)` : ""}.`,
        }),
      );
      // Reload thread list from cloud
      window.location.assign("/");
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("aether:notice", {
          detail:
            err instanceof Error
              ? err.message
              : "Could not sync local chats. Try again.",
        }),
      );
      setBusy(false);
    }
  };

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-medium text-[var(--text)]">
            Sync {pendingCount} local chat{pendingCount === 1 ? "" : "s"}?
          </div>
          <p className="leading-relaxed text-[var(--muted)]">
            Upload browser-only chats to your account.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void sync()}
              className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {busy ? "Syncing…" : "Sync to account"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={dismiss}
              className="rounded-lg px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-[var(--muted)] hover:text-[var(--text)]"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
