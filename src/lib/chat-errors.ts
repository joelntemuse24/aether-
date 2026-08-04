import { isAbortError, isServerTimeoutError } from "@/lib/chat-continue";

/** User-facing chat error copy (safe for client + server). */

export function friendlyChatError(error: unknown): string {
  if (isAbortError(error)) {
    return "";
  }
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (isServerTimeoutError(error)) {
    return "This reply hit the server time limit. Continuing automatically from where it left off…";
  }
  if (/saturat|overloaded|All providers are saturated|429|rate limit/i.test(raw)) {
    return "That model route is busy. We try backups automatically — click Retry, or pick another model.";
  }
  if (/Failed after \d+ attempts/i.test(raw)) {
    return "The model provider failed after several tries. Click Retry, or switch models.";
  }
  if (raw.trim()) return raw;
  return "Something went wrong while generating a response.";
}
