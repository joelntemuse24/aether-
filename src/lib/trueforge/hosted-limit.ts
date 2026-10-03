/**
 * Generous hosted-chat limits. In-memory, so each server instance counts
 * separately. A request that carries the user's OpenRouter key does not spend
 * the Buzz quota.
 */

export const HOSTED_IP_LIMIT = 60;
export const HOSTED_IP_WINDOW_MS = 60_000;
export const HOSTED_SESSION_LIMIT = 30;
export const HOSTED_SESSION_WINDOW_MS = 60_000;
export const DEFAULT_ANON_DAILY_CAP = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

type Bucket = { count: number; resetAt: number };

const ipBuckets = new Map<string, Bucket>();
const sessionBuckets = new Map<string, Bucket>();
const dailyBuckets = new Map<string, Bucket>();

export function resetHostedLimits(): void {
  ipBuckets.clear();
  sessionBuckets.clear();
  dailyBuckets.clear();
}

export function anonDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.AETHER_HOSTED_ANON_DAILY_CAP ?? DEFAULT_ANON_DAILY_CAP);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_ANON_DAILY_CAP;
  return Math.floor(raw);
}

export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  const ip = first || req.headers.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}

export const GUEST_COOKIE = "aether.guest";

export function readOrCreateGuestId(cookieHeader: string | null): { id: string; setCookie: string | null } {
  const match = cookieHeader?.match(/(?:^|;\s*)aether\.guest=([^;]+)/);
  const existing = match?.[1] ? decodeURIComponent(match[1]) : "";
  if (/^[A-Za-z0-9_-]{8,80}$/.test(existing)) return { id: existing, setCookie: null };
  const id = crypto.randomUUID();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    id,
    setCookie: `${GUEST_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`,
  };
}

export function hostedSessionOwner(input: { userId: string | null; guestId: string }): string {
  return input.userId ? `user:${input.userId}` : `guest:${input.guestId}`;
}

export async function withGuestCookie(
  response: Response | Promise<Response>,
  setCookie: string | null,
): Promise<Response> {
  const resolved = await response;
  if (setCookie) resolved.headers.append("Set-Cookie", setCookie);
  return resolved;
}

export type HostedLimitDecision =
  | { ok: true }
  | { ok: false; status: 429; error: string; requestId: string };

function bump(map: Map<string, Bucket>, key: string, windowMs: number, now: number): number {
  const row = map.get(key);
  if (!row || now >= row.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  row.count += 1;
  return row.count;
}

export function checkHostedTurn(input: {
  ip: string;
  sessionKey: string;
  anonymous: boolean;
  hasOpenRouterKey: boolean;
  now?: number;
  dailyCap?: number;
}): HostedLimitDecision {
  if (input.hasOpenRouterKey) return { ok: true };
  const now = input.now ?? Date.now();
  const requestId = crypto.randomUUID();
  if (bump(ipBuckets, input.ip, HOSTED_IP_WINDOW_MS, now) > HOSTED_IP_LIMIT) {
    return { ok: false, status: 429, error: "Too many hosted messages from this network. Try again later.", requestId };
  }
  if (bump(sessionBuckets, input.sessionKey, HOSTED_SESSION_WINDOW_MS, now) > HOSTED_SESSION_LIMIT) {
    return { ok: false, status: 429, error: "Too many messages in this chat. Try again later.", requestId };
  }
  if (input.anonymous && bump(dailyBuckets, input.ip, DAY_MS, now) > (input.dailyCap ?? anonDailyCap())) {
    return { ok: false, status: 429, error: "The daily hosted limit has been reached. Try again tomorrow.", requestId };
  }
  return { ok: true };
}

export function redactLoggedError(message: string): string {
  return message
    .replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

/** Browser copy plus a request id. Details stay in the server log. */
export function browserSafeChatError(error: unknown): { error: string; requestId: string } {
  const requestId = crypto.randomUUID();
  const detail = error instanceof Error ? error.message : "Request failed";
  console.error("[api/chat]", requestId, redactLoggedError(detail));
  return { error: "The request failed. Try again.", requestId };
}
