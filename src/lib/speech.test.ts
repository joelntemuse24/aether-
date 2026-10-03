import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  mergeSpokenText,
  spokenTranscriptFromResults,
  startSpeechSession,
} from "./speech";

type FakeResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type FakeRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: {
    resultIndex: number;
    results: FakeResult[] & { length: number };
  }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const SENTENCE = "I was asking about the AI harness";

function resultsFrom(
  entries: Array<{ transcript: string; isFinal: boolean }>,
): FakeResult[] {
  return entries.map((entry) => ({
    isFinal: entry.isFinal,
    0: { transcript: entry.transcript },
  }));
}

/** Android Chrome: each new final is the full phrase so far. */
function androidCumulativeFinals(sentence: string) {
  const words = sentence.split(" ");
  const events: FakeResult[][] = [];
  for (let i = 1; i <= words.length; i++) {
    const soFar: FakeResult[] = [];
    for (let j = 1; j <= i; j++) {
      soFar.push({
        isFinal: true,
        0: { transcript: words.slice(0, j).join(" ") },
      });
    }
    events.push(soFar);
  }
  return events;
}

/** Desktop Chrome: one growing result, then a second incremental final. */
function desktopIncrementalResults(sentence: string) {
  const words = sentence.split(" ");
  const mid = Math.ceil(words.length / 2);
  const first = words.slice(0, mid).join(" ");
  const second = words.slice(mid).join(" ");
  const events: Array<{ resultIndex: number; results: FakeResult[] }> = [];
  const firstWords = first.split(" ");
  for (let i = 1; i <= firstWords.length; i++) {
    events.push({
      resultIndex: 0,
      results: resultsFrom([
        { transcript: firstWords.slice(0, i).join(" "), isFinal: false },
      ]),
    });
  }
  events.push({
    resultIndex: 0,
    results: resultsFrom([{ transcript: first, isFinal: true }]),
  });
  const secondWords = second.split(" ");
  for (let i = 1; i <= secondWords.length; i++) {
    events.push({
      resultIndex: 1,
      results: resultsFrom([
        { transcript: first, isFinal: true },
        { transcript: secondWords.slice(0, i).join(" "), isFinal: false },
      ]),
    });
  }
  events.push({
    resultIndex: 1,
    results: resultsFrom([
      { transcript: first, isFinal: true },
      { transcript: second, isFinal: true },
    ]),
  });
  return events;
}

function installFakeSpeech() {
  const rec: FakeRecognition = {
    continuous: false,
    interimResults: false,
    lang: "",
    onresult: null,
    onerror: null,
    onend: null,
    start() {},
    stop() {
      rec.onend?.();
    },
    abort() {
      rec.onend?.();
    },
  };

  class SpeechRecognition {
    constructor() {
      return rec;
    }
  }

  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    SpeechRecognition,
    webkitSpeechRecognition: SpeechRecognition,
  };

  return {
    rec,
    restore() {
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previousWindow;
      }
    },
  };
}

function composerText(prefix: string, spoken: string) {
  const trimmedPrefix = prefix.trimEnd();
  if (!trimmedPrefix) return spoken;
  return spoken ? `${trimmedPrefix} ${spoken}` : trimmedPrefix;
}

describe("mergeSpokenText", () => {
  it("does not treat 'It is raining' as a continuation of 'I'", () => {
    assert.equal(mergeSpokenText("I", "It is raining"), "I It is raining");
  });
});

describe("spokenTranscriptFromResults", () => {
  it("rebuilds Android-style cumulative finals into the sentence once", () => {
    const events = androidCumulativeFinals(SENTENCE);
    const last = events[events.length - 1];
    assert.equal(spokenTranscriptFromResults(last), SENTENCE);
  });

  it("rebuilds desktop-style incremental finals into the sentence once", () => {
    const events = desktopIncrementalResults(SENTENCE);
    const last = events[events.length - 1].results;
    assert.equal(spokenTranscriptFromResults(last), SENTENCE);
  });
});

describe("startSpeechSession dictation", () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length) restores.pop()?.();
  });

  it("replays Android cumulative finals without repeating phrases", () => {
    const fake = installFakeSpeech();
    restores.push(fake.restore);

    const partials: string[] = [];
    const finals: string[] = [];
    const session = startSpeechSession({
      onPartial: (text) => partials.push(text),
      onFinal: (text) => finals.push(text),
      onError: (message) => {
        throw new Error(message);
      },
      onEnd: () => {},
    });
    assert.ok(session);
    assert.equal(fake.rec.continuous, true);
    assert.equal(fake.rec.interimResults, true);

    for (const results of androidCumulativeFinals(SENTENCE)) {
      fake.rec.onresult?.({ resultIndex: results.length - 1, results });
    }
    session!.stop();

    assert.equal(partials.at(-1), SENTENCE);
    assert.deepEqual(finals, [SENTENCE]);
    assert.equal(composerText("", finals[0]), SENTENCE);
    assert.notEqual(
      finals[0].includes("I I was") ||
        finals[0].split("I was asking").length > 2,
      true,
    );
  });

  it("replays desktop incremental results without duplicating the sentence", () => {
    const fake = installFakeSpeech();
    restores.push(fake.restore);

    const finals: string[] = [];
    let lastPartial = "";
    const session = startSpeechSession({
      onPartial: (text) => {
        lastPartial = text;
      },
      onFinal: (text) => finals.push(text),
      onError: (message) => {
        throw new Error(message);
      },
      onEnd: () => {},
    });
    assert.ok(session);

    for (const event of desktopIncrementalResults(SENTENCE)) {
      fake.rec.onresult?.(event);
    }
    session!.stop();

    assert.equal(lastPartial, SENTENCE);
    assert.deepEqual(finals, [SENTENCE]);
  });

  it("keeps pre-dictation composer text as a fixed prefix", () => {
    const fake = installFakeSpeech();
    restores.push(fake.restore);

    let spoken = "";
    const prefix = "Notes:";
    const session = startSpeechSession({
      onPartial: (text) => {
        spoken = text;
      },
      onFinal: (text) => {
        spoken = text;
      },
      onError: (message) => {
        throw new Error(message);
      },
      onEnd: () => {},
    });
    assert.ok(session);

    for (const results of androidCumulativeFinals(SENTENCE)) {
      fake.rec.onresult?.({ resultIndex: results.length - 1, results });
    }
    session!.stop();

    assert.equal(composerText(prefix, spoken), `Notes: ${SENTENCE}`);
  });

  it("does not emit the last segment twice on stop/end", () => {
    const fake = installFakeSpeech();
    restores.push(fake.restore);

    const finals: string[] = [];
    const session = startSpeechSession({
      onPartial: () => {},
      onFinal: (text) => finals.push(text),
      onError: (message) => {
        throw new Error(message);
      },
      onEnd: () => {},
    });
    assert.ok(session);

    fake.rec.onresult?.({
      resultIndex: 0,
      results: resultsFrom([{ transcript: SENTENCE, isFinal: true }]),
    });
    session!.stop();
    fake.rec.onend?.();

    assert.deepEqual(finals, [SENTENCE]);
  });

  it("merges a later recognition run without repeating a cumulative restart", () => {
    const fake = installFakeSpeech();
    restores.push(fake.restore);

    const finals: string[] = [];
    let lastPartial = "";
    const session = startSpeechSession({
      onPartial: (text) => {
        lastPartial = text;
      },
      onFinal: (text) => finals.push(text),
      onError: (message) => {
        throw new Error(message);
      },
      onEnd: () => {},
    });
    assert.ok(session);

    fake.rec.onresult?.({
      resultIndex: 0,
      results: resultsFrom([{ transcript: SENTENCE, isFinal: true }]),
    });
    fake.rec.onend?.();
    fake.rec.onresult?.({
      resultIndex: 0,
      results: resultsFrom([{ transcript: SENTENCE, isFinal: true }]),
    });
    session!.stop();

    assert.equal(lastPartial, SENTENCE);
    assert.deepEqual(finals, [SENTENCE]);
  });

  it("appends a distinct phrase after an auto-restart", () => {
    const fake = installFakeSpeech();
    restores.push(fake.restore);

    const finals: string[] = [];
    const session = startSpeechSession({
      onPartial: () => {},
      onFinal: (text) => finals.push(text),
      onError: (message) => {
        throw new Error(message);
      },
      onEnd: () => {},
    });
    assert.ok(session);

    fake.rec.onresult?.({
      resultIndex: 0,
      results: resultsFrom([{ transcript: SENTENCE, isFinal: true }]),
    });
    fake.rec.onend?.();
    fake.rec.onresult?.({
      resultIndex: 0,
      results: resultsFrom([{ transcript: "please continue", isFinal: true }]),
    });
    session!.stop();

    assert.deepEqual(finals, [`${SENTENCE} please continue`]);
  });
});
