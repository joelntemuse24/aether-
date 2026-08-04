/**
 * Client-side Google Drive helpers.
 * Uses server API routes backed by OAuth (not Google Picker / GIS token client).
 */

import type { PendingAttachment } from "./attachments";

export type DriveConnectionState = {
  connected: boolean;
  authenticated: boolean;
  email?: string | null;
  googleConfigured?: boolean;
};

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

export type DriveListResult = {
  files: DriveFileItem[];
  nextPageToken: string | null;
  folderId: string;
  folderName: string;
};

export async function fetchDriveStatus(): Promise<DriveConnectionState> {
  const res = await fetch("/api/drive/status", { cache: "no-store" });
  if (!res.ok) {
    return { connected: false, authenticated: false };
  }
  return (await res.json()) as DriveConnectionState;
}

export async function disconnectDrive(): Promise<void> {
  await fetch("/api/drive/disconnect", { method: "POST" });
}

/** Navigate to Google OAuth to connect Drive (requires login). */
export function connectDrive(): void {
  window.location.href = "/api/drive/connect";
}

export type DriveListParams = {
  folderId?: string;
  q?: string;
  type?: "all" | "recent" | "pdf" | "image" | "doc" | "sheet" | "slides";
  pageToken?: string;
};

export async function listDriveFiles(
  params: DriveListParams = {},
): Promise<DriveListResult> {
  const sp = new URLSearchParams();
  if (params.folderId) sp.set("folderId", params.folderId);
  if (params.q) sp.set("q", params.q);
  if (params.type) sp.set("type", params.type);
  if (params.pageToken) sp.set("pageToken", params.pageToken);

  const res = await fetch(`/api/drive/files?${sp.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Failed to list files (${res.status})`);
  }
  return (await res.json()) as DriveListResult;
}

export async function downloadDriveFile(
  fileId: string,
  name: string,
  mimeType: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal,
): Promise<{ attachment: PendingAttachment | null; error?: string }> {
  onProgress?.(10);

  const res = await fetch("/api/drive/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, name, mimeType }),
    signal,
  });

  onProgress?.(80);

  const data = (await res.json()) as {
    attachment?: PendingAttachment;
    error?: string;
  };

  onProgress?.(100);

  if (!res.ok && !data.attachment) {
    return {
      attachment: null,
      error: data.error || `Download failed (${res.status})`,
    };
  }

  return {
    attachment: data.attachment || null,
    error: data.error,
  };
}

/** Human-readable file size */
export function formatBytes(size?: string | number): string {
  const n = typeof size === "string" ? Number(size) : size;
  if (!n || Number.isNaN(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pick a friendly emoji-free label for mime types */
export function fileTypeLabel(mimeType: string): string {
  if (mimeType === "application/vnd.google-apps.folder") return "Folder";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType === "text/csv")
    return "Spreadsheet";
  if (mimeType.includes("document") || mimeType.includes("word")) return "Doc";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return "Slides";
  return "File";
}
