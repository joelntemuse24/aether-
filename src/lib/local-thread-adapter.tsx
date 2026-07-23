"use client";

import { useMemo, type FC, type PropsWithChildren, type ReactNode } from "react";
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

const PREFIX = "aether:";

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
    } catch {
      /* quota */
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

function simpleTitle(messages: readonly ThreadMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New chat";
  const text = firstUser.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "New chat";
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** ThreadHistoryAdapter that satisfies useAISDKRuntime's withFormat contract. */
class LocalHistoryAdapter implements ThreadHistoryAdapter {
  constructor(
    private getRemoteId: () => string | undefined,
    private ensureRemoteId: () => Promise<string>,
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

    return {
      async load(): Promise<MessageFormatRepository<TMessage>> {
        const remoteId = getRemoteId();
        if (!remoteId) return { messages: [] };

        const repo = loadFormatRepo(remoteId);
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
        const repo = loadFormatRepo(remoteId);
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
        saveFormatRepo(remoteId, repo);
      },

      async update(
        item: MessageFormatItem<TMessage>,
        localMessageId: string,
      ): Promise<void> {
        const remoteId = getRemoteId();
        if (!remoteId) return;
        const repo = loadFormatRepo(remoteId);
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
        saveFormatRepo(remoteId, repo);
      },
    };
  }
}

function LocalHistoryProvider({ children }: { children: ReactNode }) {
  const aui = useAui();

  const helpers = useMemo(
    () => ({
      getRemoteId: () => aui.threadListItem().getState().remoteId,
      ensureRemoteId: async () => {
        const { remoteId } = await aui.threadListItem().initialize();
        return remoteId;
      },
    }),
    [aui],
  );

  const history = useMemo(
    () => new LocalHistoryAdapter(helpers.getRemoteId, helpers.ensureRemoteId),
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
  return {
    unstable_Provider: LocalHistoryProvider as FC<PropsWithChildren>,

    async list() {
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
      const remoteId = threadId;
      const threads = loadThreads();
      if (!threads.some((t) => t.remoteId === remoteId)) {
        threads.unshift({ remoteId, status: "regular" });
        saveThreads(threads);
      }
      return { remoteId, externalId: undefined };
    },

    async rename(remoteId: string, newTitle: string) {
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.title = newTitle;
        saveThreads(threads);
      }
    },

    async archive(remoteId: string) {
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.status = "archived";
        saveThreads(threads);
      }
    },

    async unarchive(remoteId: string) {
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.status = "regular";
        saveThreads(threads);
      }
    },

    async delete(remoteId: string) {
      saveThreads(loadThreads().filter((t) => t.remoteId !== remoteId));
      storage.removeItem(messagesKey(remoteId));
    },

    async fetch(threadId: string) {
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
      const title = simpleTitle(messages);
      const threads = loadThreads();
      const thread = threads.find((t) => t.remoteId === remoteId);
      if (thread) {
        thread.title = title;
        saveThreads(threads);
      }
      return createAssistantStream((controller) => {
        controller.appendText(title);
      });
    },
  };
}

