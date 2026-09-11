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

/** Remember Fast/Expert on this conversation so /c/:id does not desync the picker. */
export function persistThreadSpeedTier(
  remoteId: string,
  speedTier: SpeedTier,
): void {
  const id = remoteId.trim();
  if (!id) return;
  const threads = loadThreads();
  const existing = threads.find((t) => t.remoteId === id);
  if (existing) {
    existing.custom = { ...existing.custom, speedTier };
  } else {
    threads.unshift({
      remoteId: id,
      status: "regular",
      custom: { speedTier },
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
  return parseSpeedTier(raw);
}
