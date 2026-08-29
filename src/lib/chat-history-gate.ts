type Listener = () => void;

let ready = true;
const listeners = new Set<Listener>();

export function isChatHistoryReady(): boolean {
  return ready;
}

export function setChatHistoryReady(next: boolean): void {
  if (ready === next) return;
  ready = next;
  for (const listener of listeners) listener();
}

export function waitForChatHistoryReady(timeoutMs = 8000): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => {
    const onReady = () => {
      if (!ready) return;
      clearTimeout(timer);
      listeners.delete(onReady);
      resolve();
    };
    const timer = setTimeout(() => {
      listeners.delete(onReady);
      resolve();
    }, timeoutMs);
    listeners.add(onReady);
  });
}
