/**
 * Pluggable web search providers for the harness.
 * Users never see provider names — only "Web search".
 *
 * Priority (first success wins):
 * 1. Explicit AETHER_SEARCH_PROVIDER if set
 * 2. Firecrawl (default recommended — search + rich snippets)
 * 3. Exa / Tavily when keyed
 * 4. Brave when keyed
 * 5. Keyless fallbacks (handled in web-search.ts)
 */

import type { WebSearchResult } from "@/lib/tools";

export type SearchProviderId = "firecrawl" | "brave" | "exa" | "tavily";

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

function firecrawlKey(): string | undefined {
  return (
    process.env.FIRECRAWL_API_KEY?.trim() ||
    process.env.FIRECRAWLER_API_KEY?.trim() // common typo alias
  );
}

export function configuredSearchProviders(): SearchProviderId[] {
  const preferred = process.env.AETHER_SEARCH_PROVIDER?.trim().toLowerCase();
  const available: SearchProviderId[] = [];
  if (firecrawlKey()) available.push("firecrawl");
  if (process.env.EXA_API_KEY?.trim()) available.push("exa");
  if (process.env.TAVILY_API_KEY?.trim()) available.push("tavily");
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) available.push("brave");

  const valid = new Set<SearchProviderId>([
    "firecrawl",
    "exa",
    "tavily",
    "brave",
  ]);
  if (preferred && valid.has(preferred as SearchProviderId)) {
    const id = preferred as SearchProviderId;
    const rest = available.filter((p) => p !== id);
    if (available.includes(id)) return [id, ...rest];
  }
  // Default: Firecrawl first when present (user preference over Brave).
  const order: SearchProviderId[] = ["firecrawl", "exa", "tavily", "brave"];
  return order.filter((p) => available.includes(p));
}

/**
 * Firecrawl search — SERP + optional page content.
 * @see https://docs.firecrawl.dev/api-reference/endpoint/search
 */
export async function searchFirecrawl(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const key = firecrawlKey();
  if (!key) return [];

  // v1 is widely supported; v2 uses the same auth shape.
  const res = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "User-Agent": SEARCH_UA,
    },
    body: JSON.stringify({
      query,
      limit: 8,
      // Keep payload light for the model; full scrape is fetch_url's job.
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
      },
    }),
  });
  if (!res.ok) return [];
  const parsed = await readJson(res);
  if (!parsed.ok) return [];

  const root = parsed.data as {
    success?: boolean;
    data?: unknown;
  };

  const rows = normalizeFirecrawlSearchData(root.data);
  return rows
    .map((r) => ({
      title: r.title || r.url || "Result",
      snippet: (r.snippet || r.description || r.markdown || "").slice(0, 900),
      url: r.url,
    }))
    .filter((r) => r.title || r.url)
    .slice(0, 8);
}

function normalizeFirecrawlSearchData(data: unknown): Array<{
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
  markdown?: string;
}> {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data as Array<{
      title?: string;
      url?: string;
      description?: string;
      snippet?: string;
      markdown?: string;
    }>;
  }
  if (typeof data === "object") {
    const obj = data as {
      web?: unknown[];
      news?: unknown[];
      results?: unknown[];
    };
    const combined = [
      ...(Array.isArray(obj.web) ? obj.web : []),
      ...(Array.isArray(obj.news) ? obj.news : []),
      ...(Array.isArray(obj.results) ? obj.results : []),
    ];
    return combined as Array<{
      title?: string;
      url?: string;
      description?: string;
      snippet?: string;
      markdown?: string;
    }>;
  }
  return [];
}

/** Scrape a single URL to markdown/text via Firecrawl (JS-aware). */
export async function scrapeFirecrawl(
  url: string,
  signal?: AbortSignal,
): Promise<{ ok: true; title?: string; text: string } | { ok: false }> {
  const key = firecrawlKey();
  if (!key) return { ok: false };

  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "User-Agent": SEARCH_UA,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    });
    if (!res.ok) return { ok: false };
    const parsed = await readJson(res);
    if (!parsed.ok) return { ok: false };
    const body = parsed.data as {
      success?: boolean;
      data?: {
        title?: string;
        markdown?: string;
        content?: string;
        metadata?: { title?: string };
      };
    };
    const data = body.data;
    const text = (data?.markdown || data?.content || "").trim();
    if (!text) return { ok: false };
    return {
      ok: true,
      title: data?.title || data?.metadata?.title,
      text: text.slice(0, 80_000),
    };
  } catch {
    return { ok: false };
  }
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
      let results: WebSearchResult[] = [];
      if (id === "firecrawl") results = await searchFirecrawl(query, signal);
      else if (id === "brave") results = await searchBrave(query, signal);
      else if (id === "exa") results = await searchExa(query, signal);
      else if (id === "tavily") results = await searchTavily(query, signal);
      if (results.length > 0) return { provider: id, results };
    } catch {
      // try next provider
    }
  }
  return null;
}
