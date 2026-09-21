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

export type SearchProviderId = "brave" | "exa" | "tavily" | "firecrawl";

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
  // Firecrawl search uses the key we already provision for page fetching.
  if (process.env.FIRECRAWL_API_KEY?.trim()) available.push("firecrawl");

  if (
    preferred === "exa" ||
    preferred === "tavily" ||
    preferred === "brave" ||
    preferred === "firecrawl"
  ) {
    const rest = available.filter((p) => p !== preferred);
    if (available.includes(preferred)) return [preferred, ...rest];
  }
  // Prefer research providers when present, then Brave, then Firecrawl.
  const order: SearchProviderId[] = ["exa", "tavily", "brave", "firecrawl"];
  return order.filter((p) => available.includes(p));
}

export const TAVILY_SEARCH_DEPTH = "basic";
export const SEARCH_PROVIDER_TIMEOUT_MS = 6_000;

export function firecrawlSearchPayload(query: string): {
  query: string;
  limit: number;
} {
  return { query, limit: 8 };
}

export async function raceFirstNonEmpty<T>(
  tasks: Array<{
    id: string;
    run: (signal: AbortSignal) => Promise<T[]>;
  }>,
  options: { parentSignal?: AbortSignal; perTaskMs: number },
): Promise<{ id: string; results: T[] } | null> {
  if (tasks.length === 0) return null;
  const controllers = tasks.map(() => new AbortController());
  const onParentAbort = () => {
    for (const controller of controllers) {
      if (!controller.signal.aborted) controller.abort();
    }
  };
  if (options.parentSignal?.aborted) return null;
  options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  try {
    return await new Promise((resolve) => {
      let remaining = tasks.length;
      let settled = false;
      const finish = (value: { id: string; results: T[] } | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i]!;
        const controller = controllers[i]!;
        const timer = setTimeout(() => {
          if (!controller.signal.aborted) controller.abort();
        }, options.perTaskMs);
        controller.signal.addEventListener(
          "abort",
          () => clearTimeout(timer),
          { once: true },
        );

        void (async () => {
          try {
            const results = await task.run(controller.signal);
            if (!settled && Array.isArray(results) && results.length > 0) {
              for (let j = 0; j < controllers.length; j += 1) {
                if (j !== i && !controllers[j]!.signal.aborted) {
                  controllers[j]!.abort();
                }
              }
              finish({ id: task.id, results });
              return;
            }
          } catch {
            // empty, abort, or provider error — try remaining tasks
          } finally {
            clearTimeout(timer);
            remaining -= 1;
            if (!settled && remaining === 0) finish(null);
          }
        })();
      }
    });
  } finally {
    options.parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export async function searchFirecrawl(
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) return [];
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "User-Agent": SEARCH_UA,
    },
    body: JSON.stringify(firecrawlSearchPayload(query)),
  });
  if (!res.ok) return [];
  const parsed = await readJson(res);
  if (!parsed.ok) return [];
  const data = parsed.data as {
    data?: Array<{
      title?: string;
      url?: string;
      markdown?: string;
      description?: string;
    }>;
  };
  return (data.data ?? [])
    .filter((r) => r.title || r.url)
    .map((r) => ({
      title: r.title || r.url || "Result",
      // Prefer real page content over a one-line description.
      snippet: (r.markdown || r.description || "").slice(0, 900),
      url: r.url,
    }))
    .slice(0, 8);
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
      search_depth: TAVILY_SEARCH_DEPTH,
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

async function searchByProviderId(
  id: SearchProviderId,
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult[]> {
  if (id === "brave") return searchBrave(query, signal);
  if (id === "exa") return searchExa(query, signal);
  if (id === "firecrawl") return searchFirecrawl(query, signal);
  return searchTavily(query, signal);
}

/** Race configured API providers; first non-empty hit wins. */
export async function runApiSearchProviders(
  query: string,
  signal?: AbortSignal,
): Promise<SearchProviderHit | null> {
  const providers = configuredSearchProviders();
  const hit = await raceFirstNonEmpty(
    providers.map((id) => ({
      id,
      run: (taskSignal) => searchByProviderId(id, query, taskSignal),
    })),
    { parentSignal: signal, perTaskMs: SEARCH_PROVIDER_TIMEOUT_MS },
  );
  if (!hit) return null;
  return { provider: hit.id as SearchProviderId, results: hit.results };
}
