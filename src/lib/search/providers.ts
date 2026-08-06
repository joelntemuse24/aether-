/**
 * Pluggable web search providers for the harness.
 * Users never see provider names — only "Web search".
 *
 * Priority (first success wins):
 * 1. Explicit AETHER_SEARCH_PROVIDER if set
 * 2. Exa / Tavily when keyed (research-quality)
 * 3. Brave when keyed
 * 4. Keyless fallbacks (handled in web-search.ts)
 */

import type { WebSearchResult } from "@/lib/tools";

export type SearchProviderId = "brave" | "exa" | "tavily";

export type SearchProviderHit = {
  provider: SearchProviderId;
  results: WebSearchResult[];
};

const SEARCH_UA = "AetherChat/1.0 (web_search; +https://github.com/joelntemuse24/aether-)";

async function readJson(
  res: Response,
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const text = await res.text();
    if (!text.trim()) return { ok: false };
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function configuredSearchProviders(): SearchProviderId[] {
  const preferred = process.env.AETHER_SEARCH_PROVIDER?.trim().toLowerCase();
  const available: SearchProviderId[] = [];
  if (process.env.EXA_API_KEY?.trim()) available.push("exa");
  if (process.env.TAVILY_API_KEY?.trim()) available.push("tavily");
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) available.push("brave");

  if (
    preferred === "exa" ||
    preferred === "tavily" ||
    preferred === "brave"
  ) {
    const rest = available.filter((p) => p !== preferred);
    if (available.includes(preferred)) return [preferred, ...rest];
  }
  // Prefer research providers when present, then Brave.
  const order: SearchProviderId[] = ["exa", "tavily", "brave"];
  return order.filter((p) => available.includes(p));
}

export async function searchBrave(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    query,
  )}&count=8`;
  const res = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
      "User-Agent": SEARCH_UA,
    },
  });
  if (!res.ok) return [];
  const parsed = await readJson(res);
  if (!parsed.ok) return [];
  const data = parsed.data as {
    web?: { results?: Array<{ title?: string; description?: string; url?: string }> };
  };
  return (data.web?.results ?? [])
    .filter((r) => r.title && (r.description || r.url))
    .map((r) => ({
      title: r.title || "Result",
      snippet: r.description || "",
      url: r.url,
    }))
    .slice(0, 8);
}

export async function searchExa(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "User-Agent": SEARCH_UA,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 8,
      contents: { text: { maxCharacters: 600 } },
    }),
  });
  if (!res.ok) return [];
  const parsed = await readJson(res);
  if (!parsed.ok) return [];
  const data = parsed.data as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
      summary?: string;
    }>;
  };
  return (data.results ?? [])
    .filter((r) => r.title || r.url)
    .map((r) => ({
      title: r.title || r.url || "Result",
      snippet: (r.text || r.summary || "").slice(0, 900),
      url: r.url,
    }))
    .slice(0, 8);
}

export async function searchTavily(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": SEARCH_UA,
    },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "advanced",
      max_results: 8,
      include_answer: false,
    }),
  });
  if (!res.ok) return [];
  const parsed = await readJson(res);
  if (!parsed.ok) return [];
  const data = parsed.data as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => r.title || r.url)
    .map((r) => ({
      title: r.title || r.url || "Result",
      snippet: (r.content || "").slice(0, 900),
      url: r.url,
    }))
    .slice(0, 8);
}

/** Run configured API providers in order; returns first non-empty hit. */
export async function runApiSearchProviders(
  query: string,
  signal?: AbortSignal,
): Promise<SearchProviderHit | null> {
  const providers = configuredSearchProviders();
  for (const id of providers) {
    try {
      const results =
        id === "brave"
          ? await searchBrave(query, signal)
          : id === "exa"
            ? await searchExa(query, signal)
            : await searchTavily(query, signal);
      if (results.length > 0) return { provider: id, results };
    } catch {
      // try next provider
    }
  }
  return null;
}
