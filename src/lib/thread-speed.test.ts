import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  persistThreadSpeedTier,
  loadThreadSpeedTier,
} from "./thread-speed";

function installLocalStorage() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  const globals = globalThis as typeof globalThis & {
    window?: { localStorage: typeof localStorage };
    localStorage?: typeof localStorage;
  };
  const previousWindow = globals.window;
  const previousLocalStorage = globals.localStorage;
  globals.localStorage = localStorage;
  globals.window = { localStorage };
  return () => {
    if (previousWindow === undefined) delete globals.window;
    else globals.window = previousWindow;
    if (previousLocalStorage === undefined) delete globals.localStorage;
    else globals.localStorage = previousLocalStorage;
  };
}

describe("per-thread Fast/Expert", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("remembers Fast on a conversation so /c/:id does not flip to Expert", () => {
    restore = installLocalStorage();
    persistThreadSpeedTier("thread-fast", "fast");
    persistThreadSpeedTier("thread-expert", "expert");
    assert.equal(loadThreadSpeedTier("thread-fast"), "fast");
    assert.equal(loadThreadSpeedTier("thread-expert"), "expert");
    assert.equal(loadThreadSpeedTier("missing"), null);
  });
});
