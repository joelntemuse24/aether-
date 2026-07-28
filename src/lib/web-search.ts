/**
 * Keyless web search for the chat tool.
 *
 * Priority:
 * 1. Brave Search API when BRAVE_SEARCH_API_KEY is set (real web results)
 * 2. Wikipedia (ranked list=search + extracts) — reliable on serverless
 * 3. DuckDuckGo Instant Answer (sparse; often empty on cloud IPs)
 *
 * Never lets one source's empty/invalid JSON abort the whole search —
 * that was the production "Unexpected end of JSON input" failure mode.
 */

import type { WebSearchOutput, WebSearchResult } from "@/lib/tools";

const SEARCH_TIMEOUT_MS = 12_000;

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "about",
  "from",
  "into",
  "over",
  "annual",
  "revenue",
  "financial",
  "performance",
  "strategy",
  "new",
  "markets",
  "global",
  "expansion",
  "company",
  "info",
  "information",
  "latest",
  "current",
  "what",
  "who",
  "when",
  "where",
  "how",
  "why",
]);

type JsonObject = Record<string, unknown>;

async function readJsonObject(
  res: Response,
): Promise<{ ok: true; data: JsonObject } | { ok: false; reason: string }> {
  const text = await res.text();
  if (!text.trim()) {
    return { ok: false, reason: "empty response body" };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "response was not a JSON object" };
    }
    return { ok: true, data: parsed as JsonObject };
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function wikiArticleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(
    title.replace(/ /g, "_"),
  )}`;
}

/** Prefer entity-ish queries first; full long queries rank poorly on Wikipedia. */
function wikipediaQueryVariants(query: string): string[] {
  const full = query.trim();
  const tokens = full
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9+-]/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase()))
    .filter((t) => !/^\d{4}$/.test(t));

  const variants: string[] = [];
  if (tokens[0]) variants.push(tokens[0]);
  if (tokens.length >= 2) variants.push(tokens.slice(0, 2).join(" "));
  variants.push(full);
  return [...new Set(variants.filter(Boolean))];
}

function overlapScore(result: WebSearchResult, query: string): number {
  const qTokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9+-]/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !/^\d{4}$/.test(t));
  if (qTokens.length === 0) return 0;
  const hay = `${result.title} ${result.snippet}`.toLowerCase();
  let hits = 0;
  for (const t of qTokens) {
    if (hay.includes(t)) hits += 1;
  }
  // Strong boost when the title itself matches an entity token.
  const title = result.title.toLowerCase();
  if (qTokens.some((t) => title === t || title.includes(t))) hits += 2;
  return hits;
}

function collectDdgTopics(
  topics: unknown,
  into: WebSearchResult[],
  limit: number,
): void {
  if (!Array.isArray(topics) || into.length >= limit) return;
  for (const item of topics) {
    if (!item || typeof item !== "object") continue;
    const row = item as {
      Text?: string;
      FirstURL?: string;
      Topics?: unknown;
    };
    if (typeof row.Text === "string" && row.Text.trim()) {
      into.push({
        title: row.Text.split(" - ")[0] || row.Text,
        snippet: row.Text,
        url: typeof row.FirstURL === "string" ? row.FirstURL : undefined,
      });
    } else if (row.Topics) {
      collectDdgTopics(row.Topics, into, limit);
    }
    if (into.length >= limit) return;
  }
}

async function searchBrave(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    query,
  )}&count=6`;
  const res = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
  });
  if (!res.ok) return [];

  const parsed = await readJsonObject(res);
  if (!parsed.ok) return [];

  const web = parsed.data.web as
    | { results?: Array<{ title?: string; description?: string; url?: string }> }
    | undefined;

  return (web?.results ?? [])
    .filter((r) => r.title && (r.description || r.url))
    .map((r) => ({
      title: r.title!,
      snippet: (r.description || "").slice(0, 600),
      url: r.url,
    }))
    .slice(0, 6);
}

async function searchWikipediaOnce(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const searchUrl =
    `https://en.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`;

  const searchRes = await fetch(searchUrl, {
    signal,
    headers: {
      "User-Agent": "AetherChat/1.0 (web_search tool; +https://github.com/)",
      Accept: "application/json",
    },
  });
  if (!searchRes.ok) return [];
  const searchParsed = await readJsonObject(searchRes);
  if (!searchParsed.ok) return [];

  const hits = (
    searchParsed.data.query as
      | { search?: Array<{ title: string; snippet?: string }> }
      | undefined
  )?.search;
  if (!hits?.length) return [];

  const titles = hits.map((h) => h.title).slice(0, 5);
  const extractsUrl =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts|info` +
    `&exintro=1&explaintext=1&inprop=url&titles=${titles
      .map((t) => encodeURIComponent(t))
      .join("|")}&format=json&origin=*`;

  const extractsRes = await fetch(extractsUrl, {
    signal,
    headers: {
      "User-Agent": "AetherChat/1.0 (web_search tool; +https://github.com/)",
      Accept: "application/json",
    },
  });
  if (!extractsRes.ok) {
    // Fall back to search snippets alone.
    return hits.map((h) => ({
      title: h.title,
      snippet: stripHtml(h.snippet || "").slice(0, 600),
      url: wikiArticleUrl(h.title),
    }));
  }

  const extractsParsed = await readJsonObject(extractsRes);
  const pages =
    extractsParsed.ok &&
    (
      extractsParsed.data.query as
        | {
            pages?: Record<
              string,
              { title?: string; extract?: string; fullurl?: string }
            >;
          }
        | undefined
    )?.pages;

  const byTitle = new Map<string, WebSearchResult>();
  if (pages) {
    for (const p of Object.values(pages)) {
      if (!p.title) continue;
      byTitle.set(p.title, {
        title: p.title,
        snippet: (p.extract || "").slice(0, 600),
        url: p.fullurl || wikiArticleUrl(p.title),
      });
    }
  }

  return titles.map((title, i) => {
    const fromExtract = byTitle.get(title);
    if (fromExtract?.snippet) return fromExtract;
    return {
      title,
      snippet: stripHtml(hits[i]?.snippet || "").slice(0, 600),
      url: wikiArticleUrl(title),
    };
  });
}

async function searchWikipedia(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const seen = new Set<string>();
  const merged: WebSearchResult[] = [];

  for (const variant of wikipediaQueryVariants(query)) {
    const batch = await searchWikipediaOnce(variant, signal);
    for (const row of batch) {
      const key = row.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }

  return merged
    .map((r) => ({ r, score: overlapScore(r, query) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 0 || merged.length <= 3)
    .slice(0, 6)
    .map((x) => x.r);
}

async function searchDuckDuckGo(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    `&format=json&no_html=1&skip_disambig=1`;

  const res = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "AetherChat/1.0 (web_search tool; +https://github.com/)",
      Accept: "application/json",
    },
  });
  if (!res.ok) return [];

  const parsed = await readJsonObject(res);
  if (!parsed.ok) return [];

  const data = parsed.data;
  const results: WebSearchResult[] = [];
  const abstractText =
    typeof data.AbstractText === "string" ? data.AbstractText : "";
  if (abstractText) {
    results.push({
      title: (typeof data.Heading === "string" && data.Heading) || query,
      snippet: abstractText,
      url: typeof data.AbstractURL === "string" ? data.AbstractURL : undefined,
    });
  }
  collectDdgTopics(data.RelatedTopics, results, 6);
  return results.map((r) => ({ ...r, snippet: stripHtml(r.snippet) }));
}

/** Run web search. Failures from one source never block the others. */
export async function runWebSearch(query: string): Promise<WebSearchOutput> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, query, results: [], error: "Empty search query." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const errors: string[] = [];

  const trySource = async (
    name: string,
    fn: () => Promise<WebSearchResult[]>,
  ): Promise<WebSearchOutput | null> => {
    try {
      const results = await fn();
      if (results.length > 0) {
        return { ok: true, query: trimmed, source: name, results };
      }
      return null;
    } catch (err) {
      errors.push(
        err instanceof Error && err.name === "AbortError"
          ? `${name} timed out`
          : `${name}: ${err instanceof Error ? err.message : "failed"}`,
      );
      return null;
    }
  };

  try {
    const brave = await trySource("brave", () =>
      searchBrave(trimmed, controller.signal),
    );
    if (brave) return brave;

    const wiki = await trySource("wikipedia", () =>
      searchWikipedia(trimmed, controller.signal),
    );
    if (wiki) return wiki;

    const ddg = await trySource("duckduckgo", () =>
      searchDuckDuckGo(trimmed, controller.signal),
    );
    if (ddg) return ddg;

    return {
      ok: false,
      query: trimmed,
      results: [],
      error:
        errors.length > 0
          ? `No search results. (${errors.join("; ")})`
          : "No search results found.",
    };
  } finally {
    clearTimeout(timer);
  }
}
