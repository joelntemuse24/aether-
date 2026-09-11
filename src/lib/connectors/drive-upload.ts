/**
 * Upload a generated file into the user's Drive.
 * Runs on the Aether tool seam (Vercel) — the worker never sees Drive cookies.
 */

import { getValidDriveAccessToken } from "@/lib/drive-session";
import { mimeForFilename } from "@/lib/office/file-artifact";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export const DRIVE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  "pptx",
  "xlsx",
  "pdf",
  "docx",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "csv",
  "txt",
  "md",
]);

export function isAllowedDriveUploadName(filename: string): boolean {
  const base = filename.split("/").pop()?.trim() ?? "";
  if (!base || base === "." || base === "..") return false;
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return ALLOWED_EXT.has(ext);
}

export function resolveDriveUploadMime(
  filename: string,
  mimeType?: string,
): string {
  if (mimeType && mimeType.includes("/")) return mimeType;
  return mimeForFilename(filename);
}

export function buildDriveMultipart(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  folderId?: string;
}): { body: Buffer; contentType: string } {
  const metadata: Record<string, unknown> = {
    name: input.filename,
    mimeType: input.mimeType,
  };
  if (input.folderId) metadata.parents = [input.folderId];
  const boundary = `aether-${crypto.randomUUID()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${input.mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    body: Buffer.concat([head, input.buffer, tail]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

export async function driveUploadForUser(
  userId: string,
  input: {
    filename: string;
    mimeType?: string;
    buffer: Buffer;
    folderId?: string;
  },
  accessToken?: string,
): Promise<{
  ok: boolean;
  error?: string;
  fileId?: string;
  name?: string;
  webViewLink?: string;
  folderId?: string;
}> {
  const auth = accessToken
    ? { accessToken }
    : await getValidDriveAccessToken(userId);
  if (!auth) {
    return { ok: false, error: "Google Drive is not connected." };
  }
  const filename = input.filename.split("/").filter(Boolean).pop() || "";
  if (!isAllowedDriveUploadName(filename)) {
    return {
      ok: false,
      error:
        "Drive upload accepts generated pptx, xlsx, pdf, docx (and png/csv/txt/md).",
    };
  }
  if (!input.buffer.byteLength) {
    return { ok: false, error: "File is empty." };
  }
  if (input.buffer.byteLength > DRIVE_UPLOAD_MAX_BYTES) {
    return { ok: false, error: "This file is too large to save to Drive." };
  }
  const mimeType = resolveDriveUploadMime(filename, input.mimeType);
  const multipart = buildDriveMultipart({
    filename,
    mimeType,
    buffer: input.buffer,
    folderId: input.folderId,
  });
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,parents",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        "Content-Type": multipart.contentType,
      },
      body: new Uint8Array(multipart.body),
    },
  );
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error:
        "Drive is connected for reading only. Reconnect Drive in Preferences to save files.",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `Drive upload failed (${res.status})` };
  }
  const data = (await res.json()) as {
    id?: string;
    name?: string;
    webViewLink?: string;
  };
  return {
    ok: true,
    fileId: data.id,
    name: data.name ?? filename,
    webViewLink: data.webViewLink,
    folderId: input.folderId,
  };
}

export { FOLDER_MIME };
