/** Browser text-to-speech for assistant answers. No hosted vendor. */

export const PLAYBACK_UNAVAILABLE_MESSAGE =
  "Playback isn’t available in this browser.";

export function speechSynthesisSupported(
  scope: { speechSynthesis?: unknown } | null | undefined = typeof window ===
  "undefined"
    ? null
    : window,
): boolean {
  return !!scope && typeof scope.speechSynthesis === "object" && scope.speechSynthesis !== null;
}

export function plainTextFromMessage(message: {
  parts?: Array<{ type?: string; text?: string }>;
  content?: unknown;
}): string {
  const parts = message.parts;
  if (Array.isArray(parts)) {
    const text = parts
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("\n");
    return plainTextForSpeech(text);
  }
  if (typeof message.content === "string") {
    return plainTextForSpeech(message.content);
  }
  return "";
}

export function plainTextForSpeech(raw: string): string {
  if (!raw) return "";
  let text = raw;
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\[(\d+)\]\([^)]+\)/g, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/[*_#~>]+/g, " ");
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export type SpeechUtteranceLike = {
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

export type SpeechSynthesisLike = {
  speaking: boolean;
  cancel: () => void;
  speak: (utterance: SpeechUtteranceLike) => void;
};

type SpeechSynthesisCtor = new (text: string) => SpeechUtteranceLike;

function getSynthesis(
  scope: Window | (Window & { speechSynthesis?: SpeechSynthesisLike }) | null = typeof window ===
  "undefined"
    ? null
    : window,
): SpeechSynthesisLike | null {
  if (!scope) return null;
  const synth = (scope as { speechSynthesis?: SpeechSynthesisLike }).speechSynthesis;
  return synth ?? null;
}

export function speakText(
  text: string,
  opts: {
    onEnd?: () => void;
    onError?: (message: string) => void;
    scope?: Window | null;
  } = {},
): { ok: true } | { ok: false; error: string } {
  const spoken = plainTextForSpeech(text);
  if (!spoken) {
    return { ok: false, error: "Nothing to read on this answer." };
  }
  const scope = opts.scope ?? (typeof window === "undefined" ? null : window);
  const synth = getSynthesis(scope);
  const Ctor = scope
    ? ((scope as unknown as { SpeechSynthesisUtterance?: SpeechSynthesisCtor })
        .SpeechSynthesisUtterance ?? null)
    : null;
  if (!synth || !Ctor) {
    return { ok: false, error: PLAYBACK_UNAVAILABLE_MESSAGE };
  }
  try {
    synth.cancel();
    const utterance = new Ctor(spoken);
    utterance.onend = () => opts.onEnd?.();
    utterance.onerror = (event) => {
      const code = event.error ?? "unavailable";
      if (code === "canceled" || code === "interrupted") {
        opts.onEnd?.();
        return;
      }
      opts.onError?.(PLAYBACK_UNAVAILABLE_MESSAGE);
    };
    synth.speak(utterance);
    return { ok: true };
  } catch {
    return { ok: false, error: PLAYBACK_UNAVAILABLE_MESSAGE };
  }
}

export function stopSpeaking(
  scope: Window | null = typeof window === "undefined" ? null : window,
): void {
  try {
    getSynthesis(scope)?.cancel();
  } catch {
    /* already stopped */
  }
}

export function isSpeaking(
  scope: Window | null = typeof window === "undefined" ? null : window,
): boolean {
  return getSynthesis(scope)?.speaking === true;
}
