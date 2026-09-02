/**
 * Bind the durable useChat id to assistant-ui's optimistic `__LOCALID_`
 * thread so initialize() does not mint a second UUID.
 */

const durableIdsByLocalThread = new Map<string, string>();
let fallbackDurableChatId: string | undefined;

export function resetDurableChatIdBindings() {
  durableIdsByLocalThread.clear();
  fallbackDurableChatId = undefined;
}

export function bindDurableChatId(durableId: string, localThreadId?: string) {
  const id = durableId.trim();
  if (!id) return;
  fallbackDurableChatId = id;
  const local = localThreadId?.trim();
  if (local) durableIdsByLocalThread.set(local, id);
}

export function resolveInitializedRemoteId(assistantThreadId: string): string {
  if (!assistantThreadId.startsWith("__LOCALID_")) {
    return assistantThreadId;
  }
  return (
    durableIdsByLocalThread.get(assistantThreadId) ??
    fallbackDurableChatId ??
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `chat-${Date.now()}`)
  );
}
