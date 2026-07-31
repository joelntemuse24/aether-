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

export type SpeechSession = {
  stop: () => void;
};

/**
 * Start listening. Calls `onPartial` with interim/final text, `onFinal` when
 * recognition ends with a transcript, and `onError` on permission/device errors.
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
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en-US";

  let finalText = "";
  let stopped = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const piece = result[0]?.transcript ?? "";
      if (result.isFinal) finalText += piece;
      else interim += piece;
    }
    opts.onPartial((finalText + interim).trim());
  };

  recognition.onerror = (event) => {
    const code = event.error ?? "unknown";
    if (code === "aborted" || code === "no-speech") {
      opts.onEnd();
      return;
    }
    if (code === "not-allowed" || code === "service-not-allowed") {
      opts.onError("Microphone access was blocked. Check your browser permissions.");
    } else {
      opts.onError("Couldn’t hear that — try again.");
    }
    opts.onEnd();
  };

  recognition.onend = () => {
    if (stopped) {
      opts.onEnd();
      return;
    }
    const text = finalText.trim();
    if (text) opts.onFinal(text);
    opts.onEnd();
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
      stopped = true;
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}
