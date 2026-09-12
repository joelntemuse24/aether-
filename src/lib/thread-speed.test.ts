import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  persistThreadSpeedTier,
  loadThreadSpeedTier,
  migrateStoredFastTiersToExpert,
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
  return {
    map,
    restore: () => {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
      if (previousLocalStorage === undefined) delete globals.localStorage;
      else globals.localStorage = previousLocalStorage;
    },
  };
}

describe("per-thread Cloud speed", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("migrates stored Fast conversation prefs to Expert", () => {
    const ls = installLocalStorage();
    restore = ls.restore;
    persistThreadSpeedTier("thread-fast", "fast");
    persistThreadSpeedTier("thread-expert", "expert");
    assert.equal(loadThreadSpeedTier("thread-fast"), "expert");
    assert.equal(loadThreadSpeedTier("thread-expert"), "expert");
    assert.equal(loadThreadSpeedTier("missing"), null);

    ls.map.set(
      "aether:threads",
      JSON.stringify([
        { remoteId: "old-fast", status: "regular", custom: { speedTier: "fast" } },
        { remoteId: "keep", status: "regular", custom: { speedTier: "expert" } },
      ]),
    );
    const changed = migrateStoredFastTiersToExpert();
    assert.equal(changed, 1);
    assert.equal(loadThreadSpeedTier("old-fast"), "expert");
    const stored = JSON.parse(ls.map.get("aether:threads") ?? "[]") as Array<{
      remoteId: string;
      custom?: { speedTier?: string };
    }>;
    assert.equal(stored.find((t) => t.remoteId === "old-fast")?.custom?.speedTier, "expert");
  });
});
