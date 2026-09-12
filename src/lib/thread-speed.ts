import type { SpeedTier } from "@/lib/hosted/speed-tiers";
import { parseSpeedTier } from "@/lib/hosted/speed-tiers";

const PREFIX = "aether:";
const threadsKey = `${PREFIX}threads`;

type StoredThread = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  externalId?: string;
  custom?: Record<string, unknown>;
};

function storageGet(key: string): string | null {
  if (typeof window === "undefined" && typeof localStorage === "undefined") {
    return null;
  }
  try {
    return (typeof window !== "undefined" ? window.localStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    (typeof window !== "undefined" ? window.localStorage : localStorage).setItem(key, value);
  } catch {
    // quota / private mode
  }
}

function loadThreads(): StoredThread[] {
  const raw = storageGet(threadsKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is StoredThread =>
        !!t && typeof t === "object" && typeof (t as StoredThread).remoteId === "string",
    );
  } catch {
    return [];
  }
}

function saveThreads(threads: StoredThread[]) {
  storageSet(threadsKey, JSON.stringify(threads));
}

/** Remember Expert on this conversation. Leftover Fast values are written as Expert. */
export function persistThreadSpeedTier(
  remoteId: string,
  speedTier: SpeedTier = "expert",
): void {
  const id = remoteId.trim();
  if (!id) return;
  const next = parseSpeedTier(speedTier);
  const threads = loadThreads();
  const existing = threads.find((t) => t.remoteId === id);
  if (existing) {
    existing.custom = { ...existing.custom, speedTier: next };
  } else {
    threads.unshift({
      remoteId: id,
      status: "regular",
      custom: { speedTier: next },
    });
  }
  saveThreads(threads);
}

export function loadThreadSpeedTier(remoteId: string): SpeedTier | null {
  const id = remoteId.trim();
  if (!id) return null;
  const thread = loadThreads().find((t) => t.remoteId === id);
  const raw = thread?.custom?.speedTier;
  if (raw !== "fast" && raw !== "expert") return null;
  if (raw === "fast") persistThreadSpeedTier(id, "expert");
  return "expert";
}

/** Rewrite leftover `fast` conversation prefs so old chats stay on Expert. */
export function migrateStoredFastTiersToExpert(): number {
  const threads = loadThreads();
  let changed = 0;
  for (const thread of threads) {
    if (thread.custom?.speedTier === "fast") {
      thread.custom = { ...thread.custom, speedTier: "expert" };
      changed += 1;
    }
  }
  if (changed) saveThreads(threads);
  return changed;
}
