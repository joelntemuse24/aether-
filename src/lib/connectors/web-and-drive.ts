import { getValidDriveAccessToken } from "@/lib/drive-session";
import { browsePage } from "@/lib/connectors/browse-page";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function driveSearchForUser(
  userId: string,
  query: string,
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  files: Array<{ id: string; name: string; mimeType: string; isFolder: boolean }>;
}> {
  const auth = accessToken
    ? { accessToken }
    : await getValidDriveAccessToken(userId);
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
  accessToken?: string,
): Promise<{ ok: boolean; error?: string; name?: string; text?: string }> {
  const auth = accessToken
    ? { accessToken }
    : await getValidDriveAccessToken(userId);
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

/** Compat alias — same SSRF path as browse_page, flattened for older callers. */
export async function fetchUrlText(url: string): Promise<{
  ok: boolean;
  error?: string;
  title?: string;
  text?: string;
  url: string;
  id?: string;
  warning?: string;
  paywalled?: boolean;
  contentType?: string;
  headings?: { level: number; text: string }[];
  excerpts?: string[];
  links?: { text: string; href: string }[];
  focused?: string;
}> {
  const page = await browsePage({ url });
  return {
    ok: page.ok,
    error: page.error,
    title: page.title,
    text: page.text || undefined,
    url: page.url,
    id: page.id,
    warning: page.warning,
    paywalled: page.paywalled,
    contentType: page.contentType,
    headings: page.headings,
    excerpts: page.excerpts,
    links: page.links,
    focused: page.focused,
  };
}
