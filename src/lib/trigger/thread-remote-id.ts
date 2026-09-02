/**
 * Bind the durable useChat id to assistant-ui's optimistic `__LOCALID_`
 * thread so initialize() does not mint a second UUID.
 *
 * Only the Map is used for alignment. A process-wide fallback would alias
 * an unbound new thread onto whatever chat last called bindDurableChatId.
 */

const durableIdsByLocalThread = new Map<string, string>();

export function resetDurableChatIdBindings() {
  durableIdsByLocalThread.clear();
}

export function bindDurableChatId(durableId: string, localThreadId?: string) {
  const id = durableId.trim();
  const local = localThreadId?.trim();
  if (!id || !local) return;
  durableIdsByLocalThread.set(local, id);
}

export function resolveInitializedRemoteId(assistantThreadId: string): string {
  if (!assistantThreadId.startsWith("__LOCALID_")) {
    return assistantThreadId;
  }
  return (
    durableIdsByLocalThread.get(assistantThreadId) ??
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `chat-${Date.now()}`)
  );
}
