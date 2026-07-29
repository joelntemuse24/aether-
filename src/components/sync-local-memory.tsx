"use client";

import { useEffect, useRef } from "react";
import { useSession } from "@/providers/session-provider";
import { fetchCloudStatus } from "@/lib/conversations/cloud-client";
import {
  clearLocalMemories,
  exportLocalMemoriesForMigrate,
  markLocalMemoryMigrated,
} from "@/lib/memory/local";

/**
 * When the user signs in with cloud DB available, upload browser-local
 * curated memories. Only clear/mark migrated when every local row imported.
 */
export function SyncLocalMemory() {
  const { status } = useSession();
  const running = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (running.current) return;

    let cancelled = false;
    running.current = true;

    void (async () => {
      try {
        const cloud = await fetchCloudStatus(true);
        if (cancelled || !cloud.cloud) return;

        const local = exportLocalMemoriesForMigrate();
        if (local.length === 0) {
          // Nothing to move — safe to mark so we don't keep probing.
          markLocalMemoryMigrated();
          return;
        }
        // Local still has rows → migrate even if a previous attempt marked done.

        const res = await fetch("/api/memory/migrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memories: local.map((m) => ({
              type: m.type,
              title: m.title,
              body: m.body,
              importance: m.importance,
              tags: m.tags,
            })),
          }),
        });
        if (!res.ok) return;

        const data = (await res.json()) as {
          imported?: number;
          skipped?: number;
        };
        const imported = data.imported ?? 0;
        const skipped = data.skipped ?? 0;

        if (imported > 0 && skipped === 0) {
          clearLocalMemories();
          markLocalMemoryMigrated();
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: `Moved ${imported} memor${imported === 1 ? "y" : "ies"} to your account.`,
            }),
          );
        } else if (imported > 0 && skipped > 0) {
          // Partial success: leave local so the user can retry; don't mark done.
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: `Moved ${imported} memor${imported === 1 ? "y" : "ies"}; ${skipped} could not be imported. Local copies kept — will retry.`,
            }),
          );
        } else if (skipped > 0) {
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: "Could not import local memories. Local copies kept.",
            }),
          );
        }
      } catch {
        // retry next mount / session
      } finally {
        running.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  return null;
}
