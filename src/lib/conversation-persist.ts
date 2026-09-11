/**
 * Cloud conversation PUTs must not run once per streamed token.
 * Latest-wins coalescing + a persist-now policy live here so the runtime
 * and the history adapter share one gate.
 */

export const CLOUD_PERSIST_MIN_GAP_MS = 1_200;

export type PersistStatus = "submitted" | "streaming" | "ready" | "error" | string;

export function shouldPersistMessagesImmediately(input: {
  status: PersistStatus;
  lastRole?: string;
}): boolean {
  if (input.lastRole === "user") return true;
  if (input.status === "ready" || input.status === "error") return true;
  return false;
}

/** Never replace a live turn with a cloud GET merge. */
export function shouldHydrateThreadMessages(input: {
  status: PersistStatus;
  switched: boolean;
}): boolean {
  if (input.switched) return true;
  if (input.status === "submitted" || input.status === "streaming") {
    return false;
  }
  return true;
}

export type FormatRepoLike = {
  headId?: string | null;
  entries: Array<{
    id: string;
    parent_id: string | null;
    format: string;
    content: Record<string, unknown>;
  }>;
};

export function fingerprintFormatRepo(repo: FormatRepoLike): string {
  const last = repo.entries[repo.entries.length - 1];
  const content = last?.content ?? {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  let partsSig = String(parts.length);
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const rec = part as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.length : 0;
    partsSig += `:${String(rec.type ?? "")}:${text}:${String(rec.state ?? "")}`;
  }
  const lastKeys = Object.keys(content).join(",");
  return `${repo.entries.length}:${repo.headId ?? ""}:${last?.id ?? ""}:${lastKeys}:${partsSig}`;
}

export type LatestWriteGateOptions = {
  gapMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => { cancel: () => void };
};

export type LatestWriteGate<T> = {
  enqueue: (id: string, value: T, write: (id: string, value: T) => Promise<void>) => Promise<void>;
  pendingCount: (id?: string) => number;
  inflightCount: () => number;
  reset: () => void;
};

function defaultSchedule(fn: () => void, ms: number): { cancel: () => void } {
  const timer = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(timer) };
}

/**
 * At most one in-flight write per id. Newer values replace queued ones.
 * Identical fingerprints are dropped. A minimum gap prevents PUT storms.
 */
export function createLatestWriteGate<T>(
  fingerprint: (value: T) => string,
  options: LatestWriteGateOptions = {},
): LatestWriteGate<T> {
  const gapMs = options.gapMs ?? CLOUD_PERSIST_MIN_GAP_MS;
  const now = options.now ?? (() => Date.now());
  const schedule = options.schedule ?? defaultSchedule;

  const queued = new Map<
    string,
    {
      value: T;
      write: (id: string, value: T) => Promise<void>;
      waiters: Array<{ resolve: () => void; reject: (err: unknown) => void }>;
    }
  >();
  const inflight = new Set<string>();
  const lastSent = new Map<string, { fingerprint: string; at: number }>();
  const timers = new Map<string, { cancel: () => void }>();

  const flush = (id: string) => {
    const job = queued.get(id);
    if (!job) return;
    if (inflight.has(id)) return;

    const print = fingerprint(job.value);
    const prev = lastSent.get(id);
    if (prev && prev.fingerprint === print) {
      queued.delete(id);
      for (const waiter of job.waiters) waiter.resolve();
      return;
    }

    const elapsed = prev ? now() - prev.at : gapMs;
    if (elapsed < gapMs) {
      if (timers.has(id)) return;
      const wait = gapMs - elapsed;
      timers.set(
        id,
        schedule(() => {
          timers.delete(id);
          flush(id);
        }, wait),
      );
      return;
    }

    queued.delete(id);
    inflight.add(id);
    const waiters = job.waiters;
    const write = job.write;
    void write(id, job.value)
      .then(() => {
        lastSent.set(id, { fingerprint: print, at: now() });
        for (const waiter of waiters) waiter.resolve();
      })
      .catch((err) => {
        for (const waiter of waiters) waiter.reject(err);
      })
      .finally(() => {
        inflight.delete(id);
        if (queued.has(id)) flush(id);
      });
  };

  return {
    enqueue(id, value, write) {
      const existing = queued.get(id);
      if (existing) {
        existing.value = value;
        existing.write = write;
        return new Promise<void>((resolve, reject) => {
          existing.waiters.push({ resolve, reject });
          flush(id);
        });
      }
      queued.set(id, { value, write, waiters: [] });
      return new Promise<void>((resolve, reject) => {
        queued.get(id)!.waiters.push({ resolve, reject });
        flush(id);
      });
    },
    pendingCount(id) {
      if (id) return queued.has(id) ? 1 : 0;
      return queued.size;
    },
    inflightCount() {
      return inflight.size;
    },
    reset() {
      for (const timer of timers.values()) timer.cancel();
      timers.clear();
      queued.clear();
      inflight.clear();
      lastSent.clear();
    },
  };
}
