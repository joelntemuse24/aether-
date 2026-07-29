/**
 * Bind an active project to a conversation via thread `custom.projectId`.
 * Works for localStorage threads and cloud conversations.
 */

import {
  cloudPatchThread,
  fetchCloudStatus,
} from "@/lib/conversations/cloud-client";

export const PROJECT_ID_CUSTOM_KEY = "projectId";

const THREADS_KEY = "aether:threads";

type StoredThread = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  externalId?: string;
  custom?: Record<string, unknown>;
};

function loadLocalThreads(): StoredThread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredThread[]) : [];
  } catch {
    return [];
  }
}

function saveLocalThreads(threads: StoredThread[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
  } catch {
    // ignore
  }
}

export function projectIdFromCustom(
  custom?: Record<string, unknown> | null,
): string | null {
  if (!custom) return null;
  const v = custom[PROJECT_ID_CUSTOM_KEY];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Persist projectId onto a conversation (merge into existing custom). */
export async function bindProjectToConversation(
  conversationId: string,
  projectId: string | null,
): Promise<void> {
  if (!conversationId) return;

  const cloud = await fetchCloudStatus().catch(() => ({ cloud: false }));
  if (cloud.cloud) {
    // Fetch current custom via list is heavy; merge best-effort with only projectId.
    // PATCH replaces `custom` wholesale on the server — merge with known key only
    // and preserve other keys when we can read them from local cache first.
    const local = loadLocalThreads().find((t) => t.remoteId === conversationId);
    const nextCustom: Record<string, unknown> = {
      ...(local?.custom ?? {}),
    };
    if (projectId) nextCustom[PROJECT_ID_CUSTOM_KEY] = projectId;
    else delete nextCustom[PROJECT_ID_CUSTOM_KEY];

    // Prefer cloud thread custom if list endpoint is cheap enough — use PATCH merge:
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const body = (await res.json()) as {
          thread?: { custom?: Record<string, unknown> };
        };
        const existing = body.thread?.custom ?? {};
        const merged = { ...existing };
        if (projectId) merged[PROJECT_ID_CUSTOM_KEY] = projectId;
        else delete merged[PROJECT_ID_CUSTOM_KEY];
        await cloudPatchThread(conversationId, {
          custom: Object.keys(merged).length ? merged : null,
        });
        return;
      }
    } catch {
      // fall through to local-shaped patch
    }
    await cloudPatchThread(conversationId, {
      custom: Object.keys(nextCustom).length ? nextCustom : null,
    });
    return;
  }

  const threads = loadLocalThreads();
  const thread = threads.find((t) => t.remoteId === conversationId);
  if (!thread) {
    threads.unshift({
      remoteId: conversationId,
      status: "regular",
      custom: projectId ? { [PROJECT_ID_CUSTOM_KEY]: projectId } : undefined,
    });
  } else {
    const custom = { ...(thread.custom ?? {}) };
    if (projectId) custom[PROJECT_ID_CUSTOM_KEY] = projectId;
    else delete custom[PROJECT_ID_CUSTOM_KEY];
    thread.custom = Object.keys(custom).length ? custom : undefined;
  }
  saveLocalThreads(threads);
}

export async function readConversationProjectId(
  conversationId: string,
): Promise<string | null> {
  if (!conversationId) return null;
  try {
    const cloud = await fetchCloudStatus().catch(() => ({ cloud: false }));
    if (cloud.cloud) {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const body = (await res.json()) as {
          thread?: { custom?: Record<string, unknown> };
        };
        return projectIdFromCustom(body.thread?.custom);
      }
    }
  } catch {
    // fall through
  }
  const local = loadLocalThreads().find((t) => t.remoteId === conversationId);
  return projectIdFromCustom(local?.custom);
}
