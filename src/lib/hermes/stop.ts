import type { HermesConfig } from "./config";
import { normalizeHermesBaseUrl } from "./config";

export function hermesRunStopUrl(baseUrl: string, runId: string): string {
  const id = encodeURIComponent(runId.trim());
  return `${normalizeHermesBaseUrl(baseUrl)}/v1/runs/${id}/stop`;
}

export function extractHermesRunId(input: {
  headers?: Headers;
  json?: unknown;
}): string | null {
  const fromHeader =
    input.headers?.get("x-hermes-run-id") ||
    input.headers?.get("x-run-id");
  if (fromHeader?.trim()) return fromHeader.trim().slice(0, 256);

  if (input.json && typeof input.json === "object") {
    const rec = input.json as Record<string, unknown>;
    const id = rec.run_id ?? rec.runId;
    if (typeof id === "string" && id.trim()) return id.trim().slice(0, 256);
  }
  return null;
}

/**
 * Best-effort cancel for a Hermes Runs API turn.
 * Chat Completions cancel is the aborted fetch; this is extra when a run id
 * appeared in headers or SSE.
 */
export async function stopHermesRun(args: {
  config: HermesConfig;
  runId: string;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const runId = args.runId.trim();
  if (!runId) return;
  try {
    await fetch(hermesRunStopUrl(args.config.baseUrl, runId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: args.abortSignal,
    });
  } catch {
    // Abort or network — the streamed request is already cancelled.
  }
}
