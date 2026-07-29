import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

const MAX_REDIRECTS = 3;

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  // 0.0.0.0/8
  if (n >>> 24 === 0) return true;
  // 10.0.0.0/8
  if (n >>> 24 === 10) return true;
  // 127.0.0.0/8
  if (n >>> 24 === 127) return true;
  // 169.254.0.0/16
  if (n >>> 16 === 0xa9fe) return true;
  // 172.16.0.0/12
  if (n >>> 20 === 0xac1) return true;
  // 192.168.0.0/16
  if (n >>> 16 === 0xc0a8) return true;
  // 100.64.0.0/10 (CGNAT)
  if (n >>> 22 === 0x191) return true;
  // 192.0.0.0/24, 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (docs/test)
  if (n >>> 8 === 0xc00000) return true;
  if (n >>> 8 === 0xc00002) return true;
  if (n >>> 8 === 0xc63364) return true;
  if (n >>> 8 === 0xcb0071) return true;
  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  if (n >>> 28 >= 0xe) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  // IPv4-mapped
  if (normalized.startsWith("::ffff:")) {
    const v4 = normalized.slice("::ffff:".length);
    if (net.isIP(v4) === 4) return isBlockedIpv4(v4);
  }
  // Unique local fc00::/7, link-local fe80::/10
  const first = normalized.split(":")[0] || "";
  const n = parseInt(first, 16);
  if (!Number.isNaN(n)) {
    if ((n & 0xfe00) === 0xfc00) return true;
    if ((n & 0xffc0) === 0xfe80) return true;
  }
  return false;
}

export function isBlockedIpLiteral(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (net.isIP(host)) return isBlockedIpLiteral(host);
  return false;
}

/**
 * Validate that a URL is public http(s) and does not resolve to private/link-local
 * / metadata addresses. Used by fetch_url before any network I/O.
 */
export async function assertPublicHttpUrl(
  raw: string,
): Promise<{ ok: true; url: URL } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs are allowed" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with credentials are not allowed" };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { ok: false, error: "URL host is not allowed" };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!net.isIP(host)) {
    try {
      const results = await dns.lookup(host, { all: true, verbatim: true });
      if (results.length === 0) {
        return { ok: false, error: "Could not resolve host" };
      }
      for (const r of results) {
        if (isBlockedIpLiteral(r.address)) {
          return { ok: false, error: "URL resolves to a private or blocked address" };
        }
      }
    } catch {
      return { ok: false, error: "Could not resolve host" };
    }
  }

  return { ok: true, url: parsed };
}

export async function fetchWithPublicRedirects(
  startUrl: URL,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? MAX_REDIRECTS;
  let current = startUrl;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { maxRedirects: _drop, redirect: _r, ...rest } = init as RequestInit & {
    maxRedirects?: number;
  };

  for (let i = 0; i <= maxRedirects; i++) {
    const check = await assertPublicHttpUrl(current.toString());
    if (!check.ok) {
      throw new Error(check.error);
    }
    const res = await fetch(check.url.toString(), {
      ...rest,
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        throw new Error("Redirect without Location");
      }
      if (i === maxRedirects) {
        throw new Error("Too many redirects");
      }
      current = new URL(loc, current);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
