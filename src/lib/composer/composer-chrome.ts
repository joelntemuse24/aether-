import type { MicState } from "../speech";

export function composerPlaceholder({
  micState,
  isFirstTurn,
}: {
  micState: MicState;
  isFirstTurn: boolean;
}): string {
  if (micState === "listening") return "Listening…";
  if (micState === "transcribing") return "Transcribing…";
  return isFirstTurn ? "How can I help you today?" : "Write a message…";
}

export function composerFootnote({ isFirstTurn }: { isFirstTurn: boolean }): string | null {
  return isFirstTurn ? null : "Aether can make mistakes. Check important details.";
}
