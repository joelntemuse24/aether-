import { getValidDriveAccessToken } from "@/lib/drive-session";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function driveSearchForUser(
  userId: string,
  query: string,
): Promise<{
  ok: boolean;
  error?: string;
  files: Array<{ id: string; name: string; mimeType: string; isFolder: boolean }>;
}> {
  const token = await getValidDriveAccessToken(userId);
  if (!token) {
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
    { headers: { Authorization: `Bearer ${token}` } },
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
  const token = await getValidDriveAccessToken(userId);
  if (!token) {
    return { ok: false, error: "Google Drive is not connected." };
  }

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${token}` } },
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
    headers: { Authorization: `Bearer ${token}` },
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
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Invalid URL", url };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { ok: false, error: "Only http(s) URLs are allowed", url };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "AetherChat/1.0 (fetch_url tool)",
        Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return { ok: false, error: `Fetch failed (${res.status})`, url };
    }
    const ctype = res.headers.get("content-type") || "";
    const raw = (await res.text()).slice(0, 150_000);
    let text = raw;
    let title: string | undefined;
    if (ctype.includes("html")) {
      title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
      text = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60_000);
    }
    return { ok: true, url, title, text };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Fetch failed",
      url,
    };
  } finally {
    clearTimeout(timer);
  }
}
