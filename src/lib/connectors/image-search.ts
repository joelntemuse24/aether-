export type ImageSearchHit = {
  title?: string;
  url?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
};

export type ImageSearchResultItem = {
  title: string;
  imageUrl: string;
  thumbnailUrl?: string;
  pageUrl?: string;
  width?: number;
  height?: number;
};

export type ImageSearchOutput = {
  ok: boolean;
  query: string;
  results: ImageSearchResultItem[];
  carousel: boolean;
  error?: string;
};

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeImageSearchHits(
  hits: ImageSearchHit[],
): ImageSearchResultItem[] {
  const out: ImageSearchResultItem[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const imageUrl = isHttpUrl(hit.url) ? hit.url : undefined;
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    out.push({
      title: (hit.title || "").trim() || imageUrl,
      imageUrl,
      thumbnailUrl: isHttpUrl(hit.thumbnailUrl) ? hit.thumbnailUrl : imageUrl,
      pageUrl: isHttpUrl(hit.sourceUrl) ? hit.sourceUrl : undefined,
      width: typeof hit.width === "number" ? hit.width : undefined,
      height: typeof hit.height === "number" ? hit.height : undefined,
    });
    if (out.length >= 8) break;
  }
  return out;
}

async function searchBraveImages(
  query: string,
  signal?: AbortSignal,
): Promise<ImageSearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) return [];
  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(
    query,
  )}&count=8`;
  const res = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
      "User-Agent": "AetherChat/1.0 (search_images)",
    },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      source?: string;
      thumbnail?: { src?: string };
      properties?: { url?: string; width?: number; height?: number };
    }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.properties?.url || r.url,
    thumbnailUrl: r.thumbnail?.src,
    sourceUrl: r.url || r.source,
    width: r.properties?.width,
    height: r.properties?.height,
  }));
}

async function searchWikimediaImages(
  query: string,
  signal?: AbortSignal,
): Promise<ImageSearchHit[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|size|mime",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    signal,
    headers: { "User-Agent": "AetherChat/1.0 (search_images)" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            descriptionurl?: string;
            width?: number;
            height?: number;
            mime?: string;
          }>;
        }
      >;
    };
  };
  const hits: ImageSearchHit[] = [];
  for (const page of Object.values(data.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info?.url || (info.mime && !info.mime.startsWith("image/"))) continue;
    hits.push({
      title: page.title?.replace(/^File:/, ""),
      url: info.url,
      thumbnailUrl: info.thumburl || info.url,
      sourceUrl: info.descriptionurl,
      width: info.width,
      height: info.height,
    });
  }
  return hits;
}

async function defaultImageSearch(
  query: string,
  signal?: AbortSignal,
): Promise<ImageSearchHit[]> {
  try {
    const brave = await searchBraveImages(query, signal);
    if (brave.length) return brave;
  } catch {
    // try keyless fallback
  }
  try {
    return await searchWikimediaImages(query, signal);
  } catch {
    return [];
  }
}

export async function searchImages(
  query: string,
  opts?: {
    search?: (query: string, signal?: AbortSignal) => Promise<ImageSearchHit[]>;
    signal?: AbortSignal;
  },
): Promise<ImageSearchOutput> {
  const q = query.trim();
  if (!q) {
    return {
      ok: false,
      query: q,
      results: [],
      carousel: false,
      error: "Image search needs a query.",
    };
  }
  const search = opts?.search ?? defaultImageSearch;
  const results = normalizeImageSearchHits(await search(q, opts?.signal));
  if (results.length === 0) {
    return {
      ok: false,
      query: q,
      results: [],
      carousel: false,
      error: "No images available for that query.",
    };
  }
  return { ok: true, query: q, results, carousel: true };
}
