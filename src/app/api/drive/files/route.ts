import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidDriveAccessToken } from "@/lib/drive-session";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export type DriveFileItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  thumbnailLink?: string;
  iconLink?: string;
  parents?: string[];
  webViewLink?: string;
  isFolder: boolean;
};

export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await getValidDriveAccessToken(userId);
  if (!token) {
    return NextResponse.json(
      { error: "Google Drive is not connected" },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const folderId = url.searchParams.get("folderId") || "root";
  const q = url.searchParams.get("q")?.trim() || "";
  const type = url.searchParams.get("type") || "all"; // all | recent | pdf | image | doc | sheet | slides
  const pageToken = url.searchParams.get("pageToken") || undefined;

  const clauses: string[] = ["trashed = false"];

  if (type === "recent") {
    // Recent: no parent filter, ordered by modifiedTime
  } else if (q) {
    clauses.push(`name contains '${q.replace(/'/g, "\\'")}'`);
  } else {
    clauses.push(`'${folderId}' in parents`);
  }

  if (type === "pdf") {
    clauses.push("mimeType = 'application/pdf'");
  } else if (type === "image") {
    clauses.push("mimeType contains 'image/'");
  } else if (type === "doc") {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or mimeType = 'application/msword')",
    );
  } else if (type === "sheet") {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType = 'application/vnd.ms-excel' or mimeType = 'text/csv')",
    );
  } else if (type === "slides") {
    clauses.push(
      "(mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' or mimeType = 'application/vnd.ms-powerpoint')",
    );
  }

  const params = new URLSearchParams({
    pageSize: "50",
    fields:
      "nextPageToken, files(id, name, mimeType, modifiedTime, size, thumbnailLink, iconLink, parents, webViewLink)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    q: clauses.join(" and "),
    orderBy: type === "recent" ? "viewedByMeTime desc" : "folder,name",
  });

  if (pageToken) params.set("pageToken", pageToken);

  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      cache: "no-store",
    },
  );

  if (!driveRes.ok) {
    const body = await driveRes.text().catch(() => "");
    console.error("[drive/files]", driveRes.status, body);
    if (driveRes.status === 401) {
      return NextResponse.json(
        { error: "Drive session expired. Reconnect Google Drive in Settings." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: `Failed to list Drive files (${driveRes.status})` },
      { status: driveRes.status },
    );
  }

  const data = (await driveRes.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      size?: string;
      thumbnailLink?: string;
      iconLink?: string;
      parents?: string[];
      webViewLink?: string;
    }>;
    nextPageToken?: string;
  };

  const files: DriveFileItem[] = (data.files || []).map((f) => ({
    ...f,
    isFolder: f.mimeType === FOLDER_MIME,
  }));

  // Resolve folder name for breadcrumb when not searching
  let folderName = "My Drive";
  if (folderId !== "root" && !q && type !== "recent") {
    try {
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=name,parents&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } },
      );
      if (metaRes.ok) {
        const meta = (await metaRes.json()) as {
          name?: string;
          parents?: string[];
        };
        folderName = meta.name || folderName;
      }
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    files,
    nextPageToken: data.nextPageToken || null,
    folderId,
    folderName,
  });
}
