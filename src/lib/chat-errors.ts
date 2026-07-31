/** User-facing chat error copy (safe for client + server). */

export function friendlyChatError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/timed out after|Task timed out|Runtime Timeout|AbortError/i.test(raw)) {
    return "This reply ran too long for the server limit and was stopped. Click Retry on the message to continue from where it left off.";
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
