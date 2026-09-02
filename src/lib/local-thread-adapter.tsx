"use client";

import type { UIMessage } from "ai";
import {
  useEffect,
  useMemo,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type MessageFormatRepository,
  type MessageStorageEntry,
  type GenericThreadHistoryAdapter,
  type ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
} from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";
import { useSession } from "@/providers/session-provider";
import {
  fetchCloudStatus,
  invalidateCloudStatus,
  peekCloudEnabled,
} from "@/lib/conversations/cloud-client";
import {
  formatRepoFromUIMessages,
  mergeStoredThreadWithIncoming,
  uiMessagesFromFormatRepo,
} from "@/lib/chat-history-merge";
import { ensureDurableToolStubs } from "@/lib/chat-tool-transcript";
import { resolveInitializedRemoteId } from "@/lib/trigger/thread-remote-id";

const PREFIX = "aether:";
export const ACTIVE_THREAD_KEY = `${PREFIX}active-thread`;

export function clearActiveThreadIf(remoteId: string) {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(ACTIVE_THREAD_KEY) === remoteId) {
      localStorage.removeItem(ACTIVE_THREAD_KEY);
    }
  } catch {
    // ignore
  }
}

function readActiveThreadId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(ACTIVE_THREAD_KEY);
  } catch {
    return null;
  }
}

export function clearActiveThreadId() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ACTIVE_THREAD_KEY);
  } catch {
    // ignore
  }
}

/** Pending composer attachments clear on this event (real chat switches only). */
export function announceThreadSwitch() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("aether:thread-switched"));
}

/**
 * User started a blank chat. Drop the previous active id so the first
 * remoteId assignment for this chat is not mistaken for A→B (which used to
 * wipe attachments mid-clarify / first send).
 */
export function beginNewChatSession() {
  const prev = readActiveThreadId();
  clearActiveThreadId();
  if (prev) announceThreadSwitch();
}

type StoredThread = {
  remoteId: string;
  status: "regular" | "archived";
  title?: string;
  externalId?: string;
  custom?: Record<string, unknown>;
};

type StoredFormatEntry = {
  id: string;
  parent_id: string | null;
  format: string;
  content: Record<string, unknown>;
};

type StoredFormatRepo = {
  headId?: string | null;
  entries: StoredFormatEntry[];
};

const storage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      const quota =
        err instanceof DOMException &&
        (err.name === "QuotaExceededError" ||
          err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
          err.code === 22);
      if (quota) {
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail:
              "Chat history couldn't be saved — browser storage is full. Older chats may be missing after refresh.",
          }),
        );
      }
    }
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const threadsKey = `${PREFIX}threads`;
const messagesKey = (id: string) => `${PREFIX}messages:${id}`;
const AI_SDK_FORMAT = "ai-sdk/v6";

export function listLocalThreads(): StoredThread[] {
  return loadThreads();
}

export function readLocalFormatRepo(remoteId: string): StoredFormatRepo {
  return loadFormatRepo(remoteId);
}

/** Snapshot browser-local chats for cloud import. */
export function exportLocalConversationsForMigrate(): Array<{
  id: string;
  title?: string;
  status: "regular" | "archived";
  custom?: Record<string, unknown>;
  repo: StoredFormatRepo;
}> {
  return loadThreads().map((t) => ({
    id: t.remoteId,
    title: t.title,
    status: t.status,
    custom: t.custom,
    repo: loadFormatRepo(t.remoteId),
  }));
}

export function clearAllLocalConversations(): void {
  const threads = loadThreads();
  for (const t of threads) {
    storage.removeItem(messagesKey(t.remoteId));
  }
  storage.removeItem(threadsKey);
}

/** Load persisted UI messages for a thread (used to bootstrap chat on switch/refresh). */
export function loadThreadUIMessages(remoteId: string): UIMessage[] {
  return uiMessagesFromFormatRepo(loadFormatRepo(remoteId));
}

/**
 * Snapshot the current linear UIMessage list into local history.
 * Used while a turn is still streaming so refresh doesn't lose partial output
 * (assistant-ui's history adapter only persists after isRunning → false).
 */
export function persistThreadUIMessages(
  remoteId: string,
  messages: UIMessage[],
): void {
  if (!remoteId || typeof window === "undefined") return;
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Keep the thread list entry so /c/<id> still resolves after refresh.
  const threads = loadThreads();
  if (!threads.some((t) => t.remoteId === remoteId)) {
    threads.unshift({ remoteId, status: "regular" });
    saveThreads(threads);
  }

  const durable = ensureDurableToolStubs(messages);
  saveFormatRepo(remoteId, formatRepoFromUIMessages(durable));

  // Local write is sync. Cloud catch-up is best-effort and must not block send.
  if (peekCloudEnabled()) {
    void import("@/lib/conversations/cloud-client")
      .then(({ cloudSaveMessageRepo }) =>
        cloudSaveMessageRepo(remoteId, formatRepoFromUIMessages(durable)),
      )
      .catch(() => {
        // local snapshot is already durable
      });
  }
}

/** Async loader — cloud when signed in + DB configured, else localStorage. */
export async function loadThreadUIMessagesAsync(
  remoteId: string,
): Promise<UIMessage[]> {
  try {
    const { fetchCloudStatus, cloudGetMessageRepo } = await import(
      "@/lib/conversations/cloud-client"
    );
    const status = await fetchCloudStatus();
    if (status.cloud) {
      const repo = await cloudGetMessageRepo(remoteId);
      const remote = uiMessagesFromFormatRepo(repo);
      const local = loadThreadUIMessages(remoteId);
      // Cloud persist is async — don't clobber a longer local snapshot after refresh.
      const longer = remote.length >= local.length ? remote : local;
      const shorter = remote.length >= local.length ? local : remote;
      return mergeStoredThreadWithIncoming(longer, shorter).messages;
    }
  } catch {
    // fall through to local
  }
  return loadThreadUIMessages(remoteId);
}

function loadThreads(): StoredThread[] {
  const raw = storage.getItem(threadsKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is StoredThread =>
        !!t &&
        typeof t === "object" &&
        typeof (t as StoredThread).remoteId === "string",
    );
  } catch {
    return [];
  }
}

function saveThreads(threads: StoredThread[]) {
  storage.setItem(threadsKey, JSON.stringify(threads));
}

function loadFormatRepo(remoteId: string): StoredFormatRepo {
  const raw = storage.getItem(messagesKey(remoteId));
  if (!raw) return { entries: [] };
  try {
    const parsed = JSON.parse(raw) as StoredFormatRepo;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function saveFormatRepo(remoteId: string, repo: StoredFormatRepo) {
  storage.setItem(messagesKey(remoteId), JSON.stringify(repo));
}

function firstUserText(messages: readonly ThreadMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "";
  return firstUser.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
}

async function resolveConversationTitle(
  messages: readonly ThreadMessage[],
): Promise<string> {
  const { fallbackConversationTitle } = await import(
    "@/lib/conversation-title"
  );
  const text = firstUserText(messages);
  const fallback = fallbackConversationTitle(text);
  if (!text) return fallback;

  try {
    const { buildChatHeaders, loadSettings } = await import("@/lib/settings");
    const headers = buildChatHeaders(loadSettings());
    const res = await fetch("/api/conversations/title", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { title?: string };
    if (typeof data.title === "string" && data.title.trim()) {
      return data.title.trim();
    }
  } catch {
    // offline / model failure — heuristic title is fine
  }
  return fallback;
}

/** ThreadHistoryAdapter that satisfies useAISDKRuntime's withFormat contract. */
class LocalHistoryAdapter implements ThreadHistoryAdapter {
  constructor(
    private getRemoteId: () => string | undefined,
    private ensureRemoteId: () => Promise<string>,
    private isCloudEnabled: () => boolean,
  ) {}

  async load(): Promise<ExportedMessageRepository> {
    // AI SDK path uses withFormat; this legacy path is unused.
    return { messages: [] };
  }

  async append(_item: ExportedMessageRepositoryItem): Promise<void> {
    void _item;
    // unused when withFormat is present
  }

  withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
    formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
  ): GenericThreadHistoryAdapter<TMessage> {
    const getRemoteId = this.getRemoteId;
    const ensureRemoteId = this.ensureRemoteId;
    const isCloudEnabled = this.isCloudEnabled;

    const readRepo = async (remoteId: string): Promise<StoredFormatRepo> => {
      if (isCloudEnabled()) {
        const { cloudGetMessageRepo } = await import(
          "@/lib/conversations/cloud-client"
        );
        return cloudGetMessageRepo(remoteId);
      }
      return loadFormatRepo(remoteId);
    };

    const writeRepo = async (remoteId: string, repo: StoredFormatRepo) => {
      if (isCloudEnabled()) {
        const { cloudSaveMessageRepo } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudSaveMessageRepo(remoteId, repo);
        return;
      }
      saveFormatRepo(remoteId, repo);
    };

    return {
      async load(): Promise<MessageFormatRepository<TMessage>> {
        const remoteId = getRemoteId();
        // Empty when the thread is still optimistic (no remoteId yet).
        if (!remoteId) return { messages: [] };

        const repo = await readRepo(remoteId);
        const messages: MessageFormatItem<TMessage>[] = [];

        for (const entry of repo.entries) {
          if (entry.format !== formatAdapter.format) continue;
          try {
            const stored: MessageStorageEntry<TStorageFormat> = {
              id: entry.id,
              parent_id: entry.parent_id,
              format: entry.format,
              content: entry.content as TStorageFormat,
            };
            messages.push(formatAdapter.decode(stored));
          } catch (err) {
            console.warn("[aether] skipped corrupt history entry", err);
          }
        }

        return {
          headId: repo.headId ?? null,
          messages,
        };
      },

      async append(item: MessageFormatItem<TMessage>): Promise<void> {
        const remoteId = await ensureRemoteId();
        const repo = await readRepo(remoteId);
        const id = formatAdapter.getId(item.message);
        const encoded = formatAdapter.encode(item);

        const entry: StoredFormatEntry = {
          id,
          parent_id: item.parentId,
          format: formatAdapter.format,
          content: encoded as Record<string, unknown>,
        };

        const idx = repo.entries.findIndex((e) => e.id === id);
        if (idx >= 0) repo.entries[idx] = entry;
        else repo.entries.push(entry);
        repo.headId = id;
        await writeRepo(remoteId, repo);
      },

      async update(
        item: MessageFormatItem<TMessage>,
        localMessageId: string,
      ): Promise<void> {
        const remoteId = getRemoteId();
        if (!remoteId) return;
        const repo = await readRepo(remoteId);
        const newId = formatAdapter.getId(item.message);
        const encoded = formatAdapter.encode(item);
        const entry: StoredFormatEntry = {
          id: newId,
          parent_id: item.parentId,
          format: formatAdapter.format,
          content: encoded as Record<string, unknown>,
        };

        const idx = repo.entries.findIndex(
          (e) => e.id === localMessageId || e.id === newId,
        );
        if (idx >= 0) repo.entries[idx] = entry;
        else repo.entries.push(entry);
        repo.headId = newId;
        await writeRepo(remoteId, repo);
      },
    };
  }
}

function LocalHistoryProvider({ children }: { children: ReactNode }) {
  const aui = useAui();
  const { status } = useSession();
  const [cloud, setCloud] = useState(false);

  useEffect(() => {
    invalidateCloudStatus();
    let cancelled = false;
    void fetchCloudStatus(true).then((s) => {
      if (!cancelled) setCloud(s.cloud);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const helpers = useMemo(
    () => ({
      getRemoteId: () => aui.threadListItem().getState().remoteId,
      ensureRemoteId: async () => {
        const { remoteId } = await aui.threadListItem().initialize();
        return remoteId;
      },
      isCloudEnabled: () => cloud,
    }),
    [aui, cloud],
  );

  const history = useMemo(
    () =>
      new LocalHistoryAdapter(
        helpers.getRemoteId,
        helpers.ensureRemoteId,
        helpers.isCloudEnabled,
      ),
    [helpers],
  );

  const adapters = useMemo(() => ({ history }), [history]);

  return (
    <RuntimeAdapterProvider adapters={adapters}>
      {children}
    </RuntimeAdapterProvider>
  );
}

export function createAetherThreadListAdapter(): RemoteThreadListAdapter {
  const cloudRef = { current: false };
  void import("@/lib/conversations/cloud-client").then(({ fetchCloudStatus }) =>
    fetchCloudStatus().then((s) => {
      cloudRef.current = s.cloud;
    }),
  );

  const ensureMode = async () => {
    const { fetchCloudStatus } = await import(
      "@/lib/conversations/cloud-client"
    );
    const s = await fetchCloudStatus();
    cloudRef.current = s.cloud;
    return s.cloud;
  };

  return {
    unstable_Provider: LocalHistoryProvider as FC<PropsWithChildren>,

    async list() {
      if (await ensureMode()) {
        const { cloudListThreads } = await import(
          "@/lib/conversations/cloud-client"
        );
        const threads = await cloudListThreads();
        return {
          threads: threads.map((t) => ({
            remoteId: t.remoteId,
            externalId: t.externalId,
            status: t.status,
            title: t.title,
            custom: t.custom,
          })),
        };
      }
      const threads = loadThreads();
      return {
        threads: threads.map((t) => ({
          remoteId: t.remoteId,
          externalId: t.externalId,
          status: t.status,
          title: t.title,
          custom: t.custom,
        })),
      };
    },

    async initialize(threadId: string) {
      // assistant-ui hands us `__LOCALID_…` for optimistic threads. Reuse the
      // durable useChat id when bound so Trigger session externalId, URL, and
      // localStorage all share one id. A second UUID here is the 403 mismatch.
      //
      // Return the id immediately. assistant-ui's append path can await this
      // promise before startRun; waiting on /api/conversations/status or
      // cloudCreateThread was an 8s first-send stall. Persist in the
      // background. URL /c/<id> updates from the returned remoteId.
      const remoteId = resolveInitializedRemoteId(threadId);
      const threads = loadThreads();
      if (!threads.some((t) => t.remoteId === remoteId)) {
        threads.unshift({ remoteId, status: "regular" });
        saveThreads(threads);
      }
      void (async () => {
        if (!(await ensureMode())) return;
        const { cloudCreateThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudCreateThread({ id: remoteId });
      })();
      return { remoteId, externalId: undefined };
    },

    async rename(remoteId: string, newTitle: string) {
      if (await ensureMode()) {
        const { cloudPatchThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudPatchThread(remoteId, { title: newTitle });
        return;
      }
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.title = newTitle;
        saveThreads(threads);
      }
    },

    async archive(remoteId: string) {
      if (await ensureMode()) {
        const { cloudPatchThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudPatchThread(remoteId, { status: "archived" });
        return;
      }
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.status = "archived";
        saveThreads(threads);
      }
    },

    async unarchive(remoteId: string) {
      if (await ensureMode()) {
        const { cloudPatchThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudPatchThread(remoteId, { status: "regular" });
        return;
      }
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.status = "regular";
        saveThreads(threads);
      }
    },

    async delete(remoteId: string) {
      if (await ensureMode()) {
        const { cloudDeleteThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudDeleteThread(remoteId);
        clearActiveThreadIf(remoteId);
        return;
      }
      saveThreads(loadThreads().filter((t) => t.remoteId !== remoteId));
      storage.removeItem(messagesKey(remoteId));
      clearActiveThreadIf(remoteId);
    },

    async fetch(threadId: string) {
      if (await ensureMode()) {
        const { cloudFetchThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        const thread = await cloudFetchThread(threadId);
        return {
          remoteId: thread.remoteId,
          externalId: thread.externalId,
          status: thread.status,
          title: thread.title,
          custom: thread.custom,
        };
      }
      const thread = loadThreads().find((t) => t.remoteId === threadId);
      if (!thread) {
        throw new Error(`Thread "${threadId}" not found`);
      }
      return {
        remoteId: thread.remoteId,
        externalId: thread.externalId,
        status: thread.status,
        title: thread.title,
        custom: thread.custom,
      };
    },

    async generateTitle(remoteId: string, messages: readonly ThreadMessage[]) {
      const title = await resolveConversationTitle(messages);
      if (await ensureMode()) {
        const { cloudPatchThread } = await import(
          "@/lib/conversations/cloud-client"
        );
        await cloudPatchThread(remoteId, { title });
      } else {
        const threads = loadThreads();
        const thread = threads.find((t) => t.remoteId === remoteId);
        if (thread) {
          thread.title = title;
          saveThreads(threads);
        }
      }
      return createAssistantStream((controller) => {
        controller.appendText(title);
      });
    },
  };
}

