import type { LanguageModel } from "ai";
import { APICallError } from "@ai-sdk/provider";
import { friendlyChatError } from "@/lib/chat-errors";

export { friendlyChatError };

/** Per-hop cap so a hung Expert hop can still reach Sol / DeepSeek. */
export const HOSTED_HOP_TIMEOUT_MS = 8_000;

export async function withHostedHopTimeout<T>(
  run: () => Promise<T>,
  ms = HOSTED_HOP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`hosted hop timeout after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type HostedCandidate = {
  model: LanguageModel;
  upstreamId: string;
  upstreamModelId: string;
};

type AnyLM = {
  specificationVersion: string;
  provider: string;
  modelId: string;
  supportedUrls?: unknown;
  doGenerate: (options: never) => Promise<unknown>;
  doStream: (options: never) => Promise<unknown>;
};

function asLM(model: LanguageModel): AnyLM {
  return model as unknown as AnyLM;
}

/** Errors where trying the next upstream is likely to help. */
export function isFailoverError(error: unknown): boolean {
  if (!error) return false;
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? 0;
    // Free / unpublished Cloud hops often 400/403/404 instead of 429.
    if (status === 400 || status === 403 || status === 404) return true;
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    const body = typeof error.responseBody === "string" ? error.responseBody : "";
    if (/saturat|overloaded|capacity|no available provider|no endpoints/i.test(body)) {
      return true;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /saturat|overloaded|capacity|rate limit|429|503|502|504|403|404|ECONNRESET|ETIMEDOUT|fetch failed|All providers are saturated|maxRetriesExceeded|hosted hop timeout|empty model response|no content generated/i.test(
    msg,
  );
}

/**
 * Language model that tries each hosted candidate in order.
 * Used so Buzz 429/saturation falls through to relays, then OpenRouter,
 * instead of burning AI SDK retries on a single dead upstream.
 */
export function createFailoverLanguageModel(
  candidates: HostedCandidate[],
): LanguageModel {
  if (candidates.length === 0) {
    throw new Error("No hosted model candidates configured.");
  }
  if (candidates.length === 1) {
    return candidates[0].model;
  }

  const primary = asLM(candidates[0].model);
  const chain = candidates.map((c) => `${c.upstreamId}:${c.upstreamModelId}`).join(" → ");

  const tryAll = async <T>(
    label: "doGenerate" | "doStream",
    run: (model: AnyLM, upstreamId: string) => Promise<T>,
  ): Promise<T> => {
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const model = asLM(c.model);
      try {
        console.info(`[hosted] ${label} try ${c.upstreamId}:${c.upstreamModelId}`);
        return await withHostedHopTimeout(() => run(model, c.upstreamId));
      } catch (err) {
        lastError = err;
        const hasNext = i < candidates.length - 1;
        if (!hasNext || !isFailoverError(err)) {
          throw err;
        }
        console.warn(
          `[hosted] ${label} failover ${c.upstreamId} → ${candidates[i + 1]?.upstreamId ?? "end"}`,
          err instanceof Error ? err.message || err.name : err,
        );
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All hosted upstreams failed.");
  };

  return {
    specificationVersion: primary.specificationVersion,
    provider: `aether.failover/${primary.provider}`,
    modelId: chain,
    supportedUrls: primary.supportedUrls,
    doGenerate: (options: never) =>
      tryAll("doGenerate", (model) => model.doGenerate(options)),
    doStream: (options: never) =>
      tryAll("doStream", (model) => model.doStream(options)),
  } as unknown as LanguageModel;
}
