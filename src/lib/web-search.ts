/**
 * Web search for the chat tool.
 *
 * Priority:
 * 1. API providers via search/providers (Exa → Tavily → Brave when keyed)
 * 2. DuckDuckGo HTML results page (keyless)
 * 3. Wikipedia (entity summaries)
 * 4. DuckDuckGo Instant Answer (sparse; often empty on cloud IPs)
 *
 * Never lets one source's empty/invalid JSON abort the whole search —
 * that was the production "Unexpected end of JSON input" failure mode.
 */

import type { WebSearchOutput, WebSearchResult } from "@/lib/tools";
import { fetchUrlText } from "@/lib/connectors/web-and-drive";
import { runApiSearchProviders } from "@/lib/search/providers";

const SEARCH_TIMEOUT_MS = 28_000;

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
  "parent",
  "results",
  "fiscal",
  "year",
  "billion",
  "yen",
  "net",
  "income",
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
    .replace(/&#x27;/gi, "'")
    .trim();
}

function wikiArticleUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(
    title.replace(/ /g, "_"),
  )}`;
}

/** Prefer entity-ish queries; avoid one-token generics like "Fast". */
function wikipediaQueryVariants(query: string): string[] {
  const full = query.trim();
  const tokens = full
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9+-]/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase()))
    .filter((t) => !/^\d{4}$/.test(t));

  const GENERIC = new Set([
    "fast",
    "new",
    "best",
    "top",
    "free",
    "online",
    "group",
    "inc",
    "ltd",
    "co",
  ]);

  const variants: string[] = [];
  if (tokens.length >= 2) {
    variants.push(tokens.slice(0, 2).join(" "));
    if (tokens.length >= 3) variants.push(tokens.slice(0, 3).join(" "));
  }
  if (tokens[0] && !GENERIC.has(tokens[0].toLowerCase())) {
    variants.unshift(tokens[0]);
  }
  return [...new Set(variants.filter(Boolean))].slice(0, 2);
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
  const title = result.title.toLowerCase();
  if (qTokens.some((t) => title === t || title.includes(t))) hits += 2;
  return hits;
}

function wantsCurrentFacts(query: string): boolean {
  return /\b(20\d{2}|fy\s*20\d{2}|latest|today|this week|revenue|earnings|net income|quarter|guidance|stock|price)\b/i.test(
    query,
  );
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

function decodeDdgHref(href: string): string {
  try {
    const absolute = new URL(href, "https://duckduckgo.com");
    const uddg = absolute.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return absolute.toString();
  } catch {
    return href;
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

/**
 * Keyless DuckDuckGo HTML results — the Instant Answer API is usually empty
 * for financial / current queries; the HTML endpoint still returns real links.
 */
async function searchDuckDuckGoHtml(
  query: string,
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html",
      "User-Agent":
        "Mozilla/5.0 (compatible; AetherChat/1.0; +https://github.com/)",
    },
    body: `q=${encodeURIComponent(query)}`,
    redirect: "follow",
  });
  if (!res.ok) return [];

  const html = await res.text();
  if (!html || /anomaly|captcha|challenge/i.test(html.slice(0, 2000))) {
    return [];
  }

  const results: WebSearchResult[] = [];
  const linkRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null && results.length < 6) {
    const url = decodeDdgHref(match[1] || "");
    const title = stripHtml(match[2] || "");
    if (!url || !title || !/^https?:\/\//i.test(url)) continue;
    if (/duckduckgo\.com/i.test(url)) continue;

    // Snippet: prefer the following result__snippet block.
    const after = html.slice(match.index, match.index + 1200);
    const snipMatch = after.match(
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i,
    );
    const snippet = stripHtml(snipMatch?.[1] || "").slice(0, 600);

    results.push({
      title: title.slice(0, 200),
      snippet: snippet || title,
      url,
    });
  }

  return results;
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

  // Prefer list snippets — extracts endpoint rate-limits hard under tool loops.
  return hits.slice(0, 5).map((h) => ({
    title: h.title,
    snippet: stripHtml(h.snippet || "").slice(0, 600),
    url: wikiArticleUrl(h.title),
  }));
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

async function searchDuckDuckGoInstant(
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

function withCurrencyWarning(
  query: string,
  source: string,
  results: WebSearchResult[],
): WebSearchOutput {
  const current = wantsCurrentFacts(query);
  const hasPrimaryFigures = results.some((r) =>
    /revenue|operating profit|trillion|net sales|profit attributable/i.test(
      `${r.title} ${r.snippet}`,
    ),
  );
  const warning =
    current && source === "wikipedia" && !hasPrimaryFigures
      ? "These are encyclopedia summaries — they may lack current figures. Prefer fetch_url on an IR / press URL from results, or configure BRAVE_SEARCH_API_KEY for stronger web search."
      : undefined;

  return {
    ok: true,
    query,
    source,
    results,
    ...(warning ? { warning } : {}),
  };
}

function looksLikePrimarySource(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/^https?:$/i.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    // Skip general news aggregators / encyclopedias — we want issuer IR.
    if (
      /wikipedia|wikimedia|bbc\.|nytimes|reuters|bloomberg|japantimes|yahoo\.|msn\.|cnn\./i.test(
        host,
      )
    ) {
      return false;
    }
    if (/\.pdf$/i.test(u.pathname)) return false;
    const path = `${host}${u.pathname}`.toLowerCase();
    return /\/ir\/|\/investor|investors|press.?release|newsroom|\/news\/\d|results|earnings|financial\/summary/i.test(
      path,
    );
  } catch {
    return false;
  }
}

async function wikipediaExtlinks(
  title: string,
  signal: AbortSignal,
): Promise<string[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extlinks` +
    `&titles=${encodeURIComponent(title)}&ellimit=40&format=json&origin=*`;
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
  const pages = (
    parsed.data.query as
      | { pages?: Record<string, { extlinks?: Array<{ "*": string }> }> }
      | undefined
  )?.pages;
  if (!pages) return [];
  const out: string[] = [];
  for (const page of Object.values(pages)) {
    for (const link of page.extlinks ?? []) {
      if (typeof link["*"] === "string") out.push(link["*"]);
    }
  }
  return out;
}

type ScoredLink = { url: string; score: number };

/**
 * Collect IR/investor links from a page. Nav-heavy IR hubs put dated releases
 * after ~80 generic hrefs — never stop at a tiny global cap.
 */
function extractCandidateLinks(
  html: string,
  baseUrl: string,
  year?: string,
): ScoredLink[] {
  const byUrl = new Map<string, number>();
  const bump = (url: string, delta: number) => {
    byUrl.set(url, (byUrl.get(url) ?? 0) + delta);
  };

  // Prefer dated news + results wording in the anchor context.
  const anchorRe =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let anchors = 0;
  while ((m = anchorRe.exec(html)) !== null && anchors < 400) {
    anchors += 1;
    try {
      const abs = new URL(m[1], baseUrl).toString().split("#")[0];
      const label = stripHtml(m[2] || "").toLowerCase();
      let delta = 1;
      if (/\/ir\/news\/\d{8,}/i.test(abs)) delta += 10;
      if (/\/ir\/news\/20\d{2}\.html/i.test(abs)) delta += 6;
      if (/results|earnings|fy\s*20|financial summary|consolidated/i.test(label)) {
        delta += 12;
      }
      if (year && (abs.includes(year) || label.includes(year))) delta += 4;
      if (/\/ir\/|\/investor/i.test(abs)) bump(abs, delta);
    } catch {
      // ignore
    }
  }

  // Fallback pass: bare hrefs (in case markup is unusual).
  if (byUrl.size < 5) {
    const hrefRe = /href=["']([^"']+)["']/gi;
    let hrefMatch: RegExpExecArray | null;
    let n = 0;
    while ((hrefMatch = hrefRe.exec(html)) !== null && n < 300) {
      n += 1;
      try {
        const abs = new URL(hrefMatch[1], baseUrl).toString().split("#")[0];
        if (/\/ir\/|\/investor/i.test(abs)) bump(abs, 1);
      } catch {
        // ignore
      }
    }
  }

  return [...byUrl.entries()].map(([url, score]) => ({ url, score }));
}

function scorePrimaryUrl(url: string, yearToken?: string): number {
  let s = 0;
  const lower = url.toLowerCase();
  if (yearToken && lower.includes(yearToken.toLowerCase())) s += 6;
  // Dated IR news releases: /ir/news/2410101800.html
  if (/\/ir\/news\/\d{8,}/i.test(url)) {
    s += 8;
    if (yearToken) {
      const yy = yearToken.match(/20(\d{2})/)?.[1];
      if (yy && new RegExp(`/ir/news/${yy}\\d{6,}`, "i").test(url)) s += 6;
    }
  }
  if (/results|earnings|fy20|summary|financial/i.test(url)) s += 3;
  if (/\/ir\/news\/20\d{2}\.html/i.test(url)) s += 5;
  if (/\/ir\/(?:news|library|financial)\//i.test(url)) s += 2;
  if (/\/ir\/?$/i.test(url)) s += 1;
  if (/\.pdf$/i.test(url)) s -= 5;
  return s;
}

async function fetchHtml(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const raw = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "AetherChat/1.0 (web_search enrich)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!raw.ok) return null;
    const ctype = raw.headers.get("content-type") || "";
    if (ctype && !/html|xml|text\//i.test(ctype)) return null;
    return await raw.text();
  } catch {
    return null;
  }
}

/**
 * When keyless web indexes fail, Wikipedia still finds the company.
 * Crawl a few official IR hubs and fetch the best results pages so the
 * model gets current figures instead of looping on encyclopedia intros.
 */
async function enrichWithPrimarySources(
  query: string,
  seed: WebSearchResult[],
  signal: AbortSignal,
): Promise<WebSearchResult[]> {
  if (!wantsCurrentFacts(query) || seed.length === 0) return [];

  const yearToken = query.match(/20\d{2}|fy\s*20\d{2}/i)?.[0]?.replace(/\s+/g, "");
  const year = yearToken?.match(/20\d{2}/)?.[0];
  const seen = new Set<string>();
  const pending = new Map<string, number>(); // url -> depth
  const linkBonus = new Map<string, number>(); // anchor-context boosts

  const enqueue = (url: string, depth: number, bonus = 0) => {
    let key = url.split("#")[0];
    try {
      const u = new URL(key);
      if (u.protocol === "http:") u.protocol = "https:";
      key = u.toString();
    } catch {
      return;
    }
    if (bonus) linkBonus.set(key, Math.max(linkBonus.get(key) ?? 0, bonus));
    if (seen.has(key)) return;
    seen.add(key);
    pending.set(key, depth);
  };

  const rank = (url: string) =>
    scorePrimaryUrl(url, year) + (linkBonus.get(url) ?? 0);

  for (const row of seed.slice(0, 2)) {
    const links = await wikipediaExtlinks(row.title, signal);
    for (const link of links) {
      try {
        const u = new URL(link);
        if (
          /wikipedia|wikimedia|bbc\.|nytimes|reuters|japantimes|archive\.org/i.test(
            u.hostname,
          )
        ) {
          continue;
        }
        if (!/\.(com|co\.jp|jp|com\.cn)$/i.test(u.hostname)) continue;
        const origin = `https://${u.hostname}`;
        enqueue(`${origin}/eng/ir/`, 0);
        enqueue(`${origin}/en/ir/`, 0);
        enqueue(`${origin}/ir/`, 0);
        enqueue(`${origin}/investor/`, 0);
        enqueue(`${origin}/investors/`, 0);
        enqueue(`${origin}/eng/ir/news/`, 0);
        if (year) {
          enqueue(`${origin}/eng/ir/news/${year}.html`, 0);
          enqueue(`${origin}/eng/ir/financial/summary.html`, 0);
        }
        if (looksLikePrimarySource(link)) enqueue(link, 0);
      } catch {
        // ignore
      }
    }
  }

  const leafPages: string[] = [];
  let crawls = 0;

  while (pending.size > 0 && leafPages.length < 10 && crawls < 12) {
    if (signal.aborted) break;
    const nextUrl = [...pending.keys()].sort((a, b) => rank(b) - rank(a))[0]!;
    const nextDepth = pending.get(nextUrl)!;
    pending.delete(nextUrl);
    if (nextDepth > 2) continue;
    crawls += 1;

    const html = await fetchHtml(nextUrl, signal);
    if (!html) continue;

    if (/\/ir\/news\/\d{8,}/i.test(nextUrl)) {
      leafPages.push(nextUrl);
      // Dated release pages — no need to deep-crawl their nav.
      continue;
    }

    if (nextDepth >= 2) continue;
    const host = new URL(nextUrl).hostname;
    for (const { url: link, score } of extractCandidateLinks(
      html,
      nextUrl,
      year,
    )) {
      try {
        if (new URL(link).hostname !== host) continue;
      } catch {
        continue;
      }
      if (!/\/ir\/|\/investor/i.test(link)) continue;
      if (
        rank(link) + score <= 0 &&
        !/\/ir\/news\//i.test(link) &&
        nextDepth > 0
      ) {
        continue;
      }
      enqueue(link, nextDepth + 1, score);
    }
  }

  const dated = [...seen].filter((u) => /\/ir\/news\/\d{8,}/i.test(u));
  const fetchTargets = [...new Set([...dated, ...leafPages])]
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 10);

  if (fetchTargets.length === 0) {
    fetchTargets.push(
      ...[...seen]
        .filter((u) => /\/ir\/(news\/20\d{2}|financial\/summary)/i.test(u))
        .sort((a, b) => rank(b) - rank(a))
        .slice(0, 2),
    );
  }

  const enriched: WebSearchResult[] = [];
  for (const url of fetchTargets) {
    if (signal.aborted || enriched.length >= 3) break;
    const page = await fetchUrlText(url);
    if (!page.ok || !page.text || page.text.length < 200) continue;
    const hay = page.text.toLowerCase();
    // Require substantive financial language — skip nav-only index pages.
    if (
      !/revenue|operating profit|trillion|profit attributable|consolidated results|net sales/i.test(
        hay,
      )
    ) {
      continue;
    }
    enriched.push({
      title: page.title || url,
      snippet: extractFinancialSnippet(page.text),
      url,
    });
  }

  return enriched;
}

/** Skip nav chrome; center the snippet on revenue / results language. */
function extractFinancialSnippet(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(
    /.{0,80}\b(revenue|net sales|operating profit|profit attributable|consolidated results|trillion yen)\b.{0,700}/i,
  );
  if (match?.[0]) return match[0].trim().slice(0, 900);
  // Fall back: skip a likely nav prefix.
  return cleaned.slice(Math.min(400, cleaned.length), Math.min(400, cleaned.length) + 900);
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
  ): Promise<{ name: string; results: WebSearchResult[] } | null> => {
    try {
      const results = await fn();
      if (results.length > 0) return { name, results };
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
    // API providers (Exa / Tavily / Brave) — first non-empty wins.
    try {
      const apiHit = await runApiSearchProviders(trimmed, controller.signal);
      if (apiHit && apiHit.results.length > 0) {
        return withCurrencyWarning(
          trimmed,
          apiHit.provider,
          apiHit.results,
        );
      }
    } catch (err) {
      errors.push(
        `api: ${err instanceof Error ? err.message : "provider failed"}`,
      );
    }

    const ddgHtml = await trySource("duckduckgo", () =>
      searchDuckDuckGoHtml(trimmed, controller.signal),
    );
    if (ddgHtml) {
      return withCurrencyWarning(trimmed, ddgHtml.name, ddgHtml.results);
    }

    const wiki = await trySource("wikipedia", () =>
      searchWikipedia(trimmed, controller.signal),
    );

    if (wiki) {
      let results = wiki.results;
      let source = wiki.name;
      try {
        const enriched = await enrichWithPrimarySources(
          trimmed,
          wiki.results,
          controller.signal,
        );
        if (enriched.length > 0) {
          // Primary sources first; keep a couple wiki rows for context.
          results = [...enriched, ...wiki.results.slice(0, 2)];
          source = "wikipedia+primary";
        }
      } catch (err) {
        errors.push(
          `enrich: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
      return withCurrencyWarning(trimmed, source, results);
    }

    const ddgIa = await trySource("duckduckgo-instant", () =>
      searchDuckDuckGoInstant(trimmed, controller.signal),
    );
    if (ddgIa) {
      return withCurrencyWarning(trimmed, ddgIa.name, ddgIa.results);
    }

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
