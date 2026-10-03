import { CONTINUE_USER_TEXT } from "@/lib/chat-continue";

export type TranscriptTurn = { role: "user" | "assistant"; content: string };

/** Newest turns that still fit. A follow-up must see the answer it refers to. */
export const RESUME_TRANSCRIPT_CHAR_CAP = 24_000;

/**
 * Use the id the client already has. A missing id is a new conversation and
 * cannot be resumed on the next request — the client must send a stable id.
 */
export function resolveHostedConversationId(conversationId?: string | null): string {
  const id = conversationId?.trim();
  if (id) return id;
  return `guest-${crypto.randomUUID()}`;
}

export function isContinuationRequest(userText: string): boolean {
  const text = userText.trim();
  if (!text) return false;
  if (text === CONTINUE_USER_TEXT) return true;
  return text.startsWith("Continue from where you left off");
}

/** Drop the current user line. History from the client includes it. */
export function priorTranscriptTurns(
  history: TranscriptTurn[] | undefined,
  userText: string,
): TranscriptTurn[] {
  const rows = (history ?? []).filter(
    (row) =>
      (row.role === "user" || row.role === "assistant") && row.content.trim().length > 0,
  );
  const last = rows[rows.length - 1];
  if (!last || last.role !== "user") return rows;
  const current = userText.trim();
  const priorText = last.content.trim();
  if (
    priorText === current ||
    (current.length > 0 && (current.endsWith(priorText) || priorText.endsWith(current)))
  ) {
    return rows.slice(0, -1);
  }
  return rows;
}

export function shouldReplayConversationHistory(input: {
  sessionIsNew: boolean;
  userText: string;
  priorCount: number;
}): boolean {
  if (input.priorCount <= 0) return false;
  if (input.sessionIsNew) return true;
  return isContinuationRequest(input.userText);
}

export function formatResumeTranscript(
  turns: TranscriptTurn[],
  cap = RESUME_TRANSCRIPT_CHAR_CAP,
): string {
  const kept: TranscriptTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const row = turns[i]!;
    const block = `${row.role === "assistant" ? "Assistant" : "User"}: ${row.content.trim()}`;
    if (used + block.length > cap && kept.length > 0) break;
    kept.push(row);
    used += block.length + 2;
  }
  kept.reverse();
  return kept
    .map((row) => `${row.role === "assistant" ? "Assistant" : "User"}: ${row.content.trim()}`)
    .join("\n\n");
}

/**
 * One session per conversation. A brand-new session has no sidecar turns, so
 * the follow-up carries the transcript. Continuations always carry it: the
 * interrupted answer may not have landed on the session yet.
 */
export function planHostedTurnResume(input: {
  conversationId?: string | null;
  userText: string;
  history?: TranscriptTurn[];
  sessionIsNew: boolean;
}): { conversationId: string; userText: string; replayed: boolean } {
  const conversationId = resolveHostedConversationId(input.conversationId);
  const prior = priorTranscriptTurns(input.history, input.userText);
  if (
    !shouldReplayConversationHistory({
      sessionIsNew: input.sessionIsNew,
      userText: input.userText,
      priorCount: prior.length,
    })
  ) {
    return { conversationId, userText: input.userText, replayed: false };
  }
  return {
    conversationId,
    replayed: true,
    userText: [
      "Earlier turns in this conversation (resume these; do not claim they are missing):",
      formatResumeTranscript(prior),
      "Current request:",
      input.userText,
    ].join("\n\n"),
  };
}
