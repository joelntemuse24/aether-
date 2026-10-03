/** Browser speech-to-text helpers for the composer mic. */

export type MicState = "idle" | "listening" | "transcribing";

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
};

type SpeechRecognitionEventLike = {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike> & {
    readonly length: number;
  };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

function normalizeSpoken(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** True when `next` is the same utterance as `prev`, grown or repeated. */
function isCumulativeExtension(next: string, prev: string): boolean {
  if (!prev) return Boolean(next);
  if (next === prev) return true;
  if (!next.startsWith(prev)) return false;
  const nextChar = next.charAt(prev.length);
  return nextChar === "" || /[\s.,!?;:'")\]]/.test(nextChar);
}

export function mergeSpokenText(committed: string, incoming: string): string {
  const prev = normalizeSpoken(committed);
  const next = normalizeSpoken(incoming);
  if (!next) return prev;
  if (!prev) return next;
  if (isCumulativeExtension(next, prev)) return next;
  if (isCumulativeExtension(prev, next)) return prev;
  return `${prev} ${next}`;
}

/**
 * Rebuild spoken text from the current `event.results` list.
 * Android Chrome often emits each new result as the full cumulative
 * transcript (sometimes marked final); those must replace, not append.
 */
export function spokenTranscriptFromResults(
  results: ArrayLike<SpeechRecognitionResultLike> & { readonly length: number },
): string {
  let spoken = "";
  for (let i = 0; i < results.length; i++) {
    const piece = normalizeSpoken(results[i]?.[0]?.transcript ?? "");
    if (!piece) continue;
    spoken = mergeSpokenText(spoken, piece);
  }
  return spoken;
}

export type SpeechSession = {
  stop: () => void;
};

/**
 * Start listening until the user stops the session.
 *
 * Chrome/Edge end recognition after short silence even with continuous=true;
 * we restart automatically until `stop()` is called so the mic does not
 * “time out” after a few seconds.
 */
export function startSpeechSession(opts: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}): SpeechSession | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    opts.onError("Speech input isn’t available in this browser.");
    return null;
  }

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en-US";

  let committedText = "";
  let currentText = "";
  let stopped = false;
  let ending = false;
  let finalized = false;

  const spokenSoFar = () => mergeSpokenText(committedText, currentText);

  const emitFinalOnce = () => {
    if (finalized) return;
    finalized = true;
    const text = spokenSoFar();
    if (text) opts.onFinal(text);
  };

  recognition.onresult = (event) => {
    currentText = spokenTranscriptFromResults(event.results);
    opts.onPartial(spokenSoFar());
  };

  recognition.onerror = (event) => {
    const code = event.error ?? "unknown";
    // Silence / abort: let onend restart (or finish if user stopped).
    if (code === "aborted" || code === "no-speech") {
      return;
    }
    stopped = true;
    if (code === "not-allowed" || code === "service-not-allowed") {
      opts.onError("Microphone access was blocked. Check your browser permissions.");
    } else if (code === "audio-capture") {
      opts.onError("No microphone found.");
    } else if (code === "network") {
      opts.onError("Speech service unavailable — check your network and try again.");
    } else {
      opts.onError("Couldn’t hear that — try again.");
    }
  };

  recognition.onend = () => {
    committedText = spokenSoFar();
    currentText = "";
    if (stopped || ending) {
      emitFinalOnce();
      ending = true;
      opts.onEnd();
      return;
    }
    // Browser ended the session early (common after ~silence). Keep listening.
    try {
      recognition.start();
    } catch {
      // Already started or permanently ended.
      emitFinalOnce();
      ending = true;
      opts.onEnd();
    }
  };

  try {
    recognition.start();
  } catch {
    opts.onError("Couldn’t start the microphone.");
    opts.onEnd();
    return null;
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* already stopped */
        }
        emitFinalOnce();
        ending = true;
        opts.onEnd();
      }
    },
  };
}
