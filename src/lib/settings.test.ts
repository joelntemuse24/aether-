import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_SETTINGS,
  buildChatHeaders,
  loadSettings,
  resolveModel,
} from "./settings";
import { BUZZ_MODEL_STORAGE_KEY } from "./buzz/models";
import { EXPERT_PRIMARY_MODEL } from "./hosted/speed-tiers";

function installLocalStorage() {
  const map = new Map<string, string>();
  const localStorage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  const globals = globalThis as {
    window?: { localStorage: Storage };
    localStorage?: Storage;
  };
  const previousWindow = globals.window;
  const previousLocalStorage = globals.localStorage;
  globals.localStorage = localStorage;
  globals.window = { localStorage };
  return {
    map,
    restore: () => {
      if (previousWindow === undefined) Reflect.deleteProperty(globals, "window");
      else globals.window = previousWindow;
      if (previousLocalStorage === undefined) Reflect.deleteProperty(globals, "localStorage");
      else globals.localStorage = previousLocalStorage;
    },
  };
}

describe("buildChatHeaders", () => {
  it("sends Ask by default and Auto when chosen", () => {
    const hosted = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
    });
    assert.equal(hosted["x-tool-approval-mode"], "ask");
    assert.equal(hosted["x-access-mode"], "hosted");
    assert.equal(hosted["x-speed-tier"], "expert");

    const leftoverFast = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
      speedTier: "fast",
    });
    assert.equal(leftoverFast["x-speed-tier"], "expert");

    const auto = buildChatHeaders({
      ...DEFAULT_SETTINGS,
      accessMode: "hosted",
      toolApprovalMode: "auto",
    });
    assert.equal(auto["x-tool-approval-mode"], "auto");
    assert.equal(
      buildChatHeaders({ ...DEFAULT_SETTINGS, accessMode: "hosted", openrouterKey: "sk-or-test" })[
        "x-openrouter-key"
      ],
      "sk-or-test",
    );
    assert.equal(
      "x-openrouter-key" in buildChatHeaders({ ...DEFAULT_SETTINGS, accessMode: "hosted" }),
      false,
    );
  });

  it("reads the Buzz picker at header-build time", () => {
    const ls = installLocalStorage();
    try {
      ls.map.set(BUZZ_MODEL_STORAGE_KEY, "claude-sonnet-5-5");
      assert.equal(
        buildChatHeaders({ ...DEFAULT_SETTINGS, accessMode: "hosted" })["x-model"],
        "claude-sonnet-5-5",
      );
    } finally {
      ls.restore();
    }
  });

  it("hosted resolveModel ignores leftover catalog ids and uses the Expert Cloud route", () => {
    assert.equal(DEFAULT_SETTINGS.speedTier, "expert");
    assert.equal(
      resolveModel({
        ...DEFAULT_SETTINGS,
        accessMode: "hosted",
        model: "anthropic/claude-sonnet-5",
        speedTier: "fast",
      }),
      EXPERT_PRIMARY_MODEL,
    );
    assert.equal(
      buildChatHeaders({
        ...DEFAULT_SETTINGS,
        accessMode: "hosted",
        model: "anthropic/claude-sonnet-5",
        speedTier: "fast",
      })["x-model"],
      EXPERT_PRIMARY_MODEL,
    );
  });
});

describe("loadSettings Fast migration", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("migrates stored Fast settings to Expert and writes them back", () => {
    const ls = installLocalStorage();
    restore = ls.restore;
    ls.map.set(
      "aether:settings:v1",
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        speedTier: "fast",
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      }),
    );
    const loaded = loadSettings();
    assert.equal(loaded.speedTier, "expert");
    const persisted = JSON.parse(ls.map.get("aether:settings:v1") ?? "{}") as {
      speedTier?: string;
    };
    assert.equal(persisted.speedTier, "expert");
  });
});
