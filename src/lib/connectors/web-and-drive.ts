import { getValidDriveAccessToken } from "@/lib/drive-session";
import {
  assertPublicHttpUrl,
  fetchWithPublicRedirects,
} from "@/lib/connectors/url-safety";
import { scrapeFirecrawl } from "@/lib/search/providers";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function driveSearchForUser(
  userId: string,
  query: string,
): Promise<{
  ok: boolean;
  error?: string;
  files: Array<{ id: string; name: string; mimeType: string; isFolder: boolean }>;
}> {
  const auth = await getValidDriveAccessToken(userId);
  if (!auth) {
    return { ok: false, error: "Google Drive is not connected.", files: [] };
  }
  const q = query.trim().replace(/'/g, "\\'");
  const clauses = ["trashed = false"];
  if (q) clauses.push(`name contains '${q}'`);
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    pageSize: "10",
    fields:
      "files(id,name,mimeType,modifiedTime,size,webViewLink)",
    orderBy: "modifiedTime desc",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params}`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } },
  );
  if (!res.ok) {
    return {
      ok: false,
      error: `Drive search failed (${res.status})`,
      files: [],
    };
  }
  const data = (await res.json()) as {
    files?: Array<{ id: string; name: string; mimeType: string }>;
  };
  return {
    ok: true,
    files: (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === FOLDER_MIME,
    })),
  };
}

export async function driveReadTextForUser(
  userId: string,
  fileId: string,
): Promise<{ ok: boolean; error?: string; name?: string; text?: string }> {
  const auth = await getValidDriveAccessToken(userId);
  if (!auth) {
    return { ok: false, error: "Google Drive is not connected." };
  }

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } },
  );
  if (!metaRes.ok) {
    return { ok: false, error: `Could not read file metadata (${metaRes.status})` };
  }
  const meta = (await metaRes.json()) as {
    name?: string;
    mimeType?: string;
  };
  const mime = meta.mimeType || "";
  const name = meta.name || fileId;

  let downloadUrl: string;
  if (mime === "application/vnd.google-apps.document") {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`;
  } else if (mime === "application/vnd.google-apps.spreadsheet") {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`;
  } else if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("xml") ||
    name.match(/\.(md|txt|csv|json|ts|tsx|js|py|html|css|yml|yaml)$/i)
  ) {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  } else {
    return {
      ok: false,
      error: `File type ${mime || "unknown"} is not readable as text. Attach it in the composer instead.`,
      name,
    };
  }

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  if (!res.ok) {
    return { ok: false, error: `Download failed (${res.status})`, name };
  }
  const text = (await res.text()).slice(0, 120_000);
  return { ok: true, name, text };
}

export async function fetchUrlText(url: string): Promise<{
  ok: boolean;
  error?: string;
  title?: string;
  text?: string;
  url: string;
  warning?: string;
  paywalled?: boolean;
  contentType?: string;
}> {
  // github.com HTML is mostly chrome; authenticated repo tools are the path.
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "github.com" || host === "gist.github.com") {
      return {
        ok: false,
        url,
        error:
          "Do not fetch github.com with fetch_url. Use github_get_repo, github_list_contents, and github_read_file when GitHub is connected (tool_search for 'github' if those tools are not unlocked yet).",
      };
    }
  } catch {
    // fall through to normal URL validation
  }

  const gate = await assertPublicHttpUrl(url);
  if (!gate.ok) {
    return { ok: false, error: gate.error, url };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 28_000);
  try {
    // Prefer Firecrawl scrape when configured (JS pages, cleaner main content).
    const scraped = await scrapeFirecrawl(
      gate.url.toString(),
      controller.signal,
    );
    if (scraped.ok && scraped.text.length > 40) {
      return {
        ok: true,
        url: gate.url.toString(),
        title: scraped.title,
        text: scraped.text,
        contentType: "text/markdown",
      };
    }

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
    if (!res.ok) {
      const soft =
        res.status === 401 || res.status === 403 || res.status === 402;
      return {
        ok: false,
        error: soft
          ? `Page blocked access (${res.status}) — may be paywalled or login-gated. Summarize from search snippets or ask the user to attach the file.`
          : `Fetch failed (${res.status})`,
        url: gate.url.toString(),
        paywalled: soft,
      };
    }
    const ctype = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    const rawBytes = new Uint8Array(buf.slice(0, 200_000));
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(rawBytes);

    // PDF: soft message (full extract needs a dedicated parser later).
    if (
      ctype.includes("pdf") ||
      raw.startsWith("%PDF") ||
      gate.url.pathname.toLowerCase().endsWith(".pdf")
    ) {
      const textGuess = extractPdfTextish(rawBytes);
      if (textGuess && textGuess.length > 80) {
        return {
          ok: true,
          url: gate.url.toString(),
          title: "PDF document",
          text: textGuess.slice(0, 80_000),
          contentType: "application/pdf",
          warning:
            "PDF text is best-effort. For clean extract, attach the PDF in the composer.",
        };
      }
      return {
        ok: false,
        url: gate.url.toString(),
        title: "PDF document",
        contentType: "application/pdf",
        error:
          "Could not extract text from this PDF. Attach it in the composer so Aether can read it, or paste key excerpts.",
      };
    }

    let text = raw;
    let title: string | undefined;
    let paywalled = false;
    let warning: string | undefined;

    if (ctype.includes("html") || /<html[\s>]/i.test(raw.slice(0, 500))) {
      title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
      title = title
        ?.replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
      text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80_000);

      const wall = detectPaywall(title, text, raw);
      if (wall) {
        paywalled = true;
        warning = wall;
      }
    } else if (ctype.includes("json")) {
      text = raw.slice(0, 80_000);
      title = title || "JSON";
    }

    if (!text) {
      return {
        ok: false,
        error: paywalled
          ? "Page looks paywalled and returned no readable body."
          : "Page returned no readable text.",
        url: gate.url.toString(),
        title,
        paywalled,
        warning,
      };
    }
    return {
      ok: true,
      url: gate.url.toString(),
      title,
      text,
      warning,
      paywalled: paywalled || undefined,
      contentType: ctype || undefined,
    };
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
    };
  } finally {
    clearTimeout(timer);
  }
}

function detectPaywall(
  title: string | undefined,
  text: string,
  rawHtml: string,
): string | undefined {
  const blob = `${title || ""} ${text.slice(0, 2000)} ${rawHtml.slice(0, 4000)}`;
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
