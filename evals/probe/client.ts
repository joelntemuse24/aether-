import { resolveCloudTierModel, type SpeedTier } from "../../src/lib/hosted/speed-tiers";
import { DURABLE_HEAD_START_PATH } from "../../src/lib/trigger/head-start";
import { parseChatResponseBody } from "./stream";
import type { TranscriptSnapshot } from "./types";
import type { ProbeCategory } from "./types";

export type HostedStatus = {
  available: boolean;
  chatTransport: "request" | "durable";
  defaultModel?: string;
};

export type ProbeAuth = {
  cookie?: string;
  sessionToken?: string;
};

export type LiveTurnInput = {
  baseUrl: string;
  promptId: string;
  category: ProbeCategory;
  prompt: string;
  tier: SpeedTier;
  timeoutMs: number;
  auth?: ProbeAuth;
  preferHeadStart?: boolean;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(auth?: ProbeAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.cookie?.trim()) headers.cookie = auth.cookie.trim();
  if (auth?.sessionToken?.trim()) {
    headers.authorization = `Bearer ${auth.sessionToken.trim()}`;
  }
  return headers;
}

export async function fetchHostedStatus(
  baseUrl: string,
  auth?: ProbeAuth,
): Promise<HostedStatus> {
  const res = await fetch(joinUrl(baseUrl, "/api/hosted/status"), {
    headers: authHeaders(auth),
  });
  if (!res.ok) {
    throw new Error(`hosted/status ${res.status}`);
  }
  const body = (await res.json()) as {
    available?: boolean;
    chatTransport?: string;
    defaultModel?: string;
  };
  return {
    available: body.available === true,
    chatTransport: body.chatTransport === "durable" ? "durable" : "request",
    defaultModel: body.defaultModel,
  };
}

function userMessage(id: string, text: string) {
  return {
    id,
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
}

async function readBody(res: Response): Promise<string> {
  return res.text();
}

async function postChat(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: string; timedOut: boolean; elapsedMs: number }> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const body = await readBody(res);
    return {
      status: res.status,
      body,
      timedOut: false,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const name = err instanceof Error ? err.name : "";
    const timedOut = name === "AbortError" || elapsedMs >= timeoutMs - 5;
    if (timedOut) {
      return { status: 0, body: "", timedOut: true, elapsedMs };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function snapshotFromResponse(input: {
  promptId: string;
  category: ProbeCategory;
  tier: SpeedTier;
  prompt: string;
  status: number;
  body: string;
  timedOut: boolean;
  elapsedMs: number;
  exception?: string;
}): TranscriptSnapshot {
  const parsed = input.body ? parseChatResponseBody(input.body) : {
    visibleText: "",
    rawText: "",
    eventTypes: [],
    finished: false,
    errorText: null,
    workingStripCount: 0,
  };
  const httpError =
    input.status >= 400
      ? parsed.errorText || input.body.slice(0, 400)
      : parsed.errorText;
  return {
    promptId: input.promptId,
    category: input.category,
    tier: input.tier,
    prompt: input.prompt,
    visibleText: parsed.visibleText,
    rawText: parsed.rawText,
    eventTypes: parsed.eventTypes,
    httpStatus: input.status || null,
    httpError,
    clientException: input.exception ?? null,
    elapsedMs: input.elapsedMs,
    timedOut: input.timedOut,
    finished: parsed.finished,
    workingStripCount: parsed.workingStripCount,
  };
}

/**
 * Fire one hosted turn. Prefer Head Start when status says durable,
 * then fall back to POST /api/chat (same headers as buildChatHeaders).
 */
export async function runLiveTurn(input: LiveTurnInput): Promise<{
  snap: TranscriptSnapshot;
  transport: "request" | "head-start";
}> {
  const model = resolveCloudTierModel(input.tier);
  const headers = {
    "content-type": "application/json",
    "x-access-mode": "hosted",
    "x-speed-tier": input.tier,
    "x-model": model,
    "x-tools": "1",
    "x-tool-approval-mode": "ask",
    ...authHeaders(input.auth),
  };
  const message = userMessage(`probe-${input.promptId}-${input.tier}`, input.prompt);

  const tryHeadStart = input.preferHeadStart !== false;
  if (tryHeadStart) {
    const head = await postChat(
      joinUrl(input.baseUrl, DURABLE_HEAD_START_PATH),
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          chatId: `probe-${crypto.randomUUID()}`,
          messages: [message],
          metadata: {
            accessMode: "hosted",
            speedTier: input.tier,
            model,
            toolsEnabled: true,
            origin: input.baseUrl,
          },
        }),
      },
      input.timeoutMs,
    );
    if (head.timedOut || (head.status > 0 && head.status < 400)) {
      return {
        transport: "head-start",
        snap: snapshotFromResponse({
          promptId: input.promptId,
          category: input.category,
          tier: input.tier,
          prompt: input.prompt,
          ...head,
        }),
      };
    }
    if (head.status !== 503 && head.status !== 404) {
      return {
        transport: "head-start",
        snap: snapshotFromResponse({
          promptId: input.promptId,
          category: input.category,
          tier: input.tier,
          prompt: input.prompt,
          ...head,
        }),
      };
    }
  }

  const request = await postChat(
    joinUrl(input.baseUrl, "/api/chat"),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [message],
        model,
        speedTier: input.tier,
      }),
    },
    input.timeoutMs,
  );
  return {
    transport: "request",
    snap: snapshotFromResponse({
      promptId: input.promptId,
      category: input.category,
      tier: input.tier,
      prompt: input.prompt,
      ...request,
    }),
  };
}

export function fixtureSnapshot(
  partial: Partial<TranscriptSnapshot> &
    Pick<TranscriptSnapshot, "promptId" | "category" | "tier" | "prompt">,
): TranscriptSnapshot {
  return {
    visibleText: "",
    rawText: "",
    eventTypes: [],
    httpStatus: 200,
    httpError: null,
    clientException: null,
    elapsedMs: 12,
    timedOut: false,
    finished: true,
    workingStripCount: 0,
    ...partial,
  };
}
