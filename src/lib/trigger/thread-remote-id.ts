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

/** Bound durable id only — never mints. History append uses this to skip initialize(). */
export function peekBoundDurableChatId(
  localThreadId?: string | null,
): string | undefined {
  const local = localThreadId?.trim();
  if (!local) return undefined;
  return durableIdsByLocalThread.get(local);
}

/**
 * Persist first-send history against the already-bound useChat id.
 * Calling initialize() here remounts useChat and blanks the live answer.
 */
export function resolveHistoryPersistId(input: {
  existingRemoteId?: string | null;
  localThreadId?: string | null;
}): { id: string; initialize: false } | { id: null; initialize: true } {
  const existing = input.existingRemoteId?.trim();
  if (existing) return { id: existing, initialize: false };
  const bound = peekBoundDurableChatId(input.localThreadId);
  if (bound) return { id: bound, initialize: false };
  return { id: null, initialize: true };
}

export function resolveInitializedRemoteId(assistantThreadId: string): string {
  if (!assistantThreadId.startsWith("__LOCALID_")) {
    return assistantThreadId;
  }
  return (
    peekBoundDurableChatId(assistantThreadId) ??
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `chat-${Date.now()}`)
  );
}
