/**
 * Browser client for auth-gated cloud conversation APIs.
 */

export type CloudStatus = {
  configured: boolean;
  signedIn: boolean;
  cloud: boolean;
};

export type CloudThread = {
  remoteId: string;
  title?: string;
  status: "regular" | "archived";
  externalId?: string;
  custom?: Record<string, unknown>;
  updatedAt?: string;
};

export type CloudFormatRepo = {
  headId?: string | null;
  entries: Array<{
    id: string;
    parent_id: string | null;
    format: string;
    content: Record<string, unknown>;
  }>;
};

let statusCache: CloudStatus | null = null;
let statusInflight: Promise<CloudStatus> | null = null;

export async function fetchCloudStatus(
  force = false,
): Promise<CloudStatus> {
  if (!force && statusCache) return statusCache;
  if (!force && statusInflight) return statusInflight;

  statusInflight = (async () => {
    try {
      const res = await fetch("/api/conversations/status", { cache: "no-store" });
      if (!res.ok) {
        statusCache = { configured: false, signedIn: false, cloud: false };
        return statusCache;
      }
      const data = (await res.json()) as CloudStatus;
      statusCache = {
        configured: !!data.configured,
        signedIn: !!data.signedIn,
        cloud: !!data.cloud,
      };
      return statusCache;
    } catch {
      statusCache = { configured: false, signedIn: false, cloud: false };
      return statusCache;
    } finally {
      statusInflight = null;
    }
  })();

  return statusInflight;
}

export function peekCloudEnabled(): boolean {
  return statusCache?.cloud === true;
}

export function invalidateCloudStatus(): void {
  statusCache = null;
}

export async function cloudListThreads(): Promise<CloudThread[]> {
  const res = await fetch("/api/conversations", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to list conversations");
  const data = (await res.json()) as { threads?: CloudThread[] };
  return data.threads ?? [];
}

export async function cloudFetchThread(id: string): Promise<CloudThread> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Thread "${id}" not found`);
  const data = (await res.json()) as { thread: CloudThread };
  return data.thread;
}

export async function cloudCreateThread(input: {
  id: string;
  title?: string;
  status?: "regular" | "archived";
  custom?: Record<string, unknown>;
}): Promise<CloudThread> {
  const res = await fetch("/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Failed to create conversation");
  }
  const data = (await res.json()) as { thread: CloudThread };
  return data.thread;
}

export async function cloudPatchThread(
  id: string,
  patch: {
    title?: string;
    status?: "regular" | "archived";
    custom?: Record<string, unknown> | null;
  },
): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update conversation");
}

export async function cloudDeleteThread(id: string): Promise<void> {
  const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
}

export async function cloudGetMessageRepo(id: string): Promise<CloudFormatRepo> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(id)}/messages`,
    { cache: "no-store" },
  );
  if (!res.ok) return { entries: [] };
  const data = (await res.json()) as { repo?: CloudFormatRepo };
  return data.repo ?? { entries: [] };
}

export async function cloudSaveMessageRepo(
  id: string,
  repo: CloudFormatRepo,
): Promise<void> {
  const res = await fetch(
    `/api/conversations/${encodeURIComponent(id)}/messages`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo }),
    },
  );
  if (!res.ok) throw new Error("Failed to save messages");
}

export async function cloudMigrate(
  items: Array<{
    id: string;
    title?: string;
    status?: "regular" | "archived";
    custom?: Record<string, unknown>;
    repo?: CloudFormatRepo;
  }>,
): Promise<{ imported: number; skipped: number }> {
  const res = await fetch("/api/conversations/migrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Migration failed");
  }
  return (await res.json()) as { imported: number; skipped: number };
}
