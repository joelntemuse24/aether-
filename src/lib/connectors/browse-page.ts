import {
  assertPublicHttpUrl,
  fetchWithPublicRedirects,
} from "@/lib/connectors/url-safety";

export type BrowseHeading = { level: number; text: string };
export type BrowseLink = { text: string; href: string };

export type BrowsePageExtract = {
  ok: boolean;
  url: string;
  title?: string;
  description?: string;
  headings: BrowseHeading[];
  links: BrowseLink[];
  excerpts: string[];
  text: string;
  focused?: string;
  instructions?: string;
  warning?: string;
  paywalled?: boolean;
  contentType?: string;
  error?: string;
  id?: string;
};

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "with",
  "this",
  "that",
  "from",
  "what",
  "when",
  "where",
  "which",
  "have",
  "has",
  "had",
  "not",
  "but",
  "you",
  "your",
  "into",
  "about",
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "));
}

function stripChrome(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ");
}

function metaContent(html: string, name: string): string | undefined {
  const named = html.match(
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
  )?.[1];
  const reversed = html.match(
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i",
    ),
  )?.[1];
  const value = named || reversed;
  return value ? decodeEntities(value) : undefined;
}

function tokensOf(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function scoreAgainst(text: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const hay = text.toLowerCase();
  let n = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) n += 1;
  }
  return n;
}

function detectPaywall(title: string | undefined, text: string, raw: string): string | undefined {
  const blob = `${title || ""} ${text.slice(0, 2000)} ${raw.slice(0, 4000)}`;
  if (
    /\b(subscribe to (continue|read)|sign in to continue|create a free account to|members only|paywall|metered paywall)\b/i.test(
      blob,
    )
  ) {
    return "Possible paywall — treat extracted text as partial; prefer other sources or user attachment.";
  }
  if (text.length < 400 && /\b(log in|sign in|subscribe)\b/i.test(blob)) {
    return "Short body with login/subscribe cues — content may be gated.";
  }
  return undefined;
}

/** Very rough PDF text extraction without a full parser (uncompressed streams). */
function extractPdfTextish(bytes: Uint8Array): string {
  const asLatin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){3,}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(asLatin)) && chunks.length < 400) {
    const inner = m[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\(.)/g, "$1");
    if (/[A-Za-z]{3,}/.test(inner)) chunks.push(inner);
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function githubBlocked(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "github.com" || host === "gist.github.com") {
      return "Do not fetch github.com with browse_page or fetch_url. Use github_get_repo, github_list_contents, and github_read_file when GitHub is connected (tool_search for 'github' if those tools are not unlocked yet).";
    }
  } catch {
    return null;
  }
  return null;
}

export function extractStructuredPage(input: {
  html: string;
  url: string;
  instructions?: string;
  contentType?: string;
}): BrowsePageExtract {
  const raw = input.html;
  const body = stripChrome(raw);
  const title = decodeEntities(
    raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "",
  ) || undefined;
  const description =
    metaContent(raw, "description") || metaContent(raw, "og:description");

  const headings: BrowseHeading[] = [];
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(body)) && headings.length < 24) {
    const text = stripTags(hm[2] || "");
    if (text) headings.push({ level: Number(hm[1]), text });
  }

  const excerpts: string[] = [];
  const paraRe = /<(p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = paraRe.exec(body)) && excerpts.length < 40) {
    const text = stripTags(pm[2] || "");
    if (text.length >= 40) excerpts.push(text.slice(0, 600));
  }

  const links: BrowseLink[] = [];
  const seen = new Set<string>();
  const linkRe = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(body)) && links.length < 20) {
    let href = lm[1] || "";
    try {
      href = new URL(href, input.url).toString();
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    const text = stripTags(lm[2] || "") || href;
    links.push({ text: text.slice(0, 120), href });
  }

  const instructions = input.instructions?.trim() || undefined;
  const queryTokens = instructions ? tokensOf(instructions) : [];
  let focused: string | undefined;
  if (instructions && queryTokens.length > 0) {
    const ranked = [...excerpts, ...headings.map((h) => h.text)]
      .map((row) => ({ row, score: scoreAgainst(row, queryTokens) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((row) => row.row);
    if (ranked.length) focused = ranked.join("\n\n");
  }

  const text = (focused || excerpts.join("\n\n") || stripTags(body))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000);
  const wall = detectPaywall(title, text, raw);

  return {
    ok: text.length > 0,
    url: input.url,
    title,
    description,
    headings,
    links,
    excerpts: excerpts.slice(0, 16),
    text,
    focused,
    instructions,
    warning: wall,
    paywalled: wall ? true : undefined,
    contentType: input.contentType,
    error: text ? undefined : "Page returned no readable text.",
  };
}

export async function browsePage(input: {
  url: string;
  instructions?: string;
}): Promise<BrowsePageExtract> {
  const url = input.url;
  const gh = githubBlocked(url);
  if (gh) {
    return {
      ok: false,
      url,
      error: gh,
      headings: [],
      links: [],
      excerpts: [],
      text: "",
    };
  }

  const gate = await assertPublicHttpUrl(url);
  if (!gate.ok) {
    return {
      ok: false,
      url,
      error: gate.error,
      headings: [],
      links: [],
      excerpts: [],
      text: "",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetchWithPublicRedirects(gate.url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AetherChat/1.0; +https://github.com/joelntemuse24/aether-)",
        Accept:
          "text/html,text/plain,application/json,application/pdf;q=0.9,*/*;q=0.1",
      },
      maxRedirects: 5,
    });
    const finalUrl = gate.url.toString();
    if (!res.ok) {
      const soft = res.status === 401 || res.status === 403 || res.status === 402;
      return {
        ok: false,
        url: finalUrl,
        error: soft
          ? `Page blocked access (${res.status}) — may be paywalled or login-gated. Summarize from search snippets or ask the user to attach the file.`
          : `Fetch failed (${res.status})`,
        paywalled: soft,
        headings: [],
        links: [],
        excerpts: [],
        text: "",
      };
    }

    const ctype = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    const rawBytes = new Uint8Array(buf.slice(0, 200_000));
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);

    if (
      ctype.includes("pdf") ||
      raw.startsWith("%PDF") ||
      gate.url.pathname.toLowerCase().endsWith(".pdf")
    ) {
      const textGuess = extractPdfTextish(rawBytes);
      if (textGuess && textGuess.length > 80) {
        const excerpts = textGuess
          .split(/(?<=\.)\s+/)
          .filter((p) => p.length > 40)
          .slice(0, 12);
        return {
          ok: true,
          url: finalUrl,
          title: "PDF document",
          headings: [],
          links: [],
          excerpts,
          text: textGuess.slice(0, 12_000),
          instructions: input.instructions?.trim() || undefined,
          contentType: "application/pdf",
          warning:
            "PDF text is best-effort. For clean extract, attach the PDF in the composer.",
        };
      }
      return {
        ok: false,
        url: finalUrl,
        title: "PDF document",
        contentType: "application/pdf",
        error:
          "Could not extract text from this PDF. Attach it in the composer so Aether can read it, or paste key excerpts.",
        headings: [],
        links: [],
        excerpts: [],
        text: "",
      };
    }

    if (ctype.includes("json")) {
      const text = raw.slice(0, 12_000);
      return {
        ok: true,
        url: finalUrl,
        title: "JSON",
        headings: [],
        links: [],
        excerpts: [text.slice(0, 600)],
        text,
        instructions: input.instructions?.trim() || undefined,
        contentType: ctype,
      };
    }

    const extracted = extractStructuredPage({
      html: raw,
      url: finalUrl,
      instructions: input.instructions,
      contentType: ctype || undefined,
    });
    return extracted;
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? "Fetch timed out after 20s."
        : err instanceof Error
          ? err.message
          : "Fetch failed";
    return {
      ok: false,
      error: message,
      url,
      headings: [],
      links: [],
      excerpts: [],
      text: "",
    };
  } finally {
    clearTimeout(timer);
  }
}
