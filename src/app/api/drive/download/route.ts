import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import {
  isImageFile,
  isTextFile,
  MAX_EMBEDDED_FILE_BYTES,
  MAX_EMBEDDED_IMAGE_BYTES,
} from "@/lib/attachments";
import { extractOfficeText, isOfficeFile } from "@/lib/office-text";

const MAX_BYTES = 25 * 1024 * 1024;

function parseDriveError(body: string): { reason?: string; message?: string } {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
    const err = parsed?.error;
    if (err?.errors?.[0]?.reason) {
      return {
        reason: err.errors[0].reason,
        message: err.message || err.errors[0].message,
      };
    }
    if (err?.status) return { reason: err.status, message: err.message };
  } catch {
    // not JSON
  }
  return {};
}

async function fetchWithAuth(
  url: string,
  accessToken: string,
  timeoutMs = 60_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
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

  const body = (await req.json()) as {
    fileId?: string;
    name?: string;
    mimeType?: string;
  };

  const fileId = body.fileId;
  const name = body.name || "file";
  const mimeType = body.mimeType || "application/octet-stream";

  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const accessToken = token.accessToken;

  const isGoogleDoc =
    mimeType === "application/vnd.google-apps.document" ||
    mimeType === "application/vnd.google-apps.spreadsheet" ||
    mimeType === "application/vnd.google-apps.presentation" ||
    mimeType === "application/vnd.google-apps.drawing";

  try {
    if (isGoogleDoc) {
      let exportMime = "text/plain";
      let ext = ".txt";
      if (mimeType.includes("spreadsheet")) {
        exportMime = "text/csv";
        ext = ".csv";
      } else if (mimeType.includes("presentation")) {
        exportMime = "text/plain";
        ext = ".txt";
      }

      let exportUrl =
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export` +
        `?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`;

      let res = await fetchWithAuth(exportUrl, accessToken);

      if (res.status === 403) {
        const errBody = await res.text().catch(() => "");
        const { reason } = parseDriveError(errBody);
        console.error("[drive/download] export 403, retrying with acknowledgeAbuse", reason);
        exportUrl += "&acknowledgeAbuse=true";
        res = await fetchWithAuth(exportUrl, accessToken);
        if (!res.ok) {
          return NextResponse.json({
            attachment: { id, name, kind: "file", mime: mimeType, size: 0 },
            error: `Cannot download "${name}" (${reason || 403}). Try the paperclip instead.`,
          });
        }
      } else if (!res.ok) {
        return NextResponse.json({
          attachment: { id, name, kind: "file", mime: mimeType, size: 0 },
          error: `Could not export "${name}" (${res.status}).`,
        });
      }

      const text = await res.text();
      const capped =
        text.length > 120_000
          ? text.slice(0, 120_000) + "\n\n[… truncated]"
          : text;

      return NextResponse.json({
        attachment: {
          id,
          name: name.endsWith(ext) ? name : name + ext,
          kind: "text",
          mime: exportMime,
          size: capped.length,
          text: capped,
        },
      });
    }

    // Binary / uploaded files
    let apiUrl =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      `?alt=media&supportsAllDrives=true`;

    let res = await fetchWithAuth(apiUrl, accessToken);

    if (res.status === 403) {
      const errBody = await res.text().catch(() => "");
      const { reason } = parseDriveError(errBody);
      console.error("[drive/download] 403, retrying with acknowledgeAbuse", reason);
      apiUrl += "&acknowledgeAbuse=true";
      res = await fetchWithAuth(apiUrl, accessToken);

      if (!res.ok) {
        // Fallback: web download endpoint
        const webUrl = `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
        const webRes = await fetchWithAuth(webUrl, accessToken);
        if (webRes.ok) {
          res = webRes;
        } else {
          return NextResponse.json({
            attachment: { id, name, kind: "file", mime: mimeType, size: 0 },
            error:
              `Could not download "${name}" from Drive. ` +
              `Open it and use the paperclip: https://drive.google.com/file/d/${fileId}/view`,
          });
        }
      }
    } else if (!res.ok) {
      return NextResponse.json({
        attachment: { id, name, kind: "file", mime: mimeType, size: 0 },
        error:
          res.status === 401
            ? "Google session expired. Reconnect Drive in Settings."
            : `Could not download "${name}" (${res.status}).`,
      });
    }

    const blob = await res.blob();
    if (blob.size > MAX_BYTES) {
      return NextResponse.json({
        attachment: {
          id,
          name,
          kind: "file",
          mime: mimeType,
          size: blob.size,
        },
        error: `"${name}" is larger than 25 MB — attached as a reference only.`,
      });
    }

    if (isImageFile(name, mimeType)) {
      if (blob.size > MAX_EMBEDDED_IMAGE_BYTES) {
        const mb = (MAX_EMBEDDED_IMAGE_BYTES / (1024 * 1024)).toFixed(0);
        return NextResponse.json({
          attachment: {
            id,
            name,
            kind: "image",
            mime: mimeType,
            size: blob.size,
          },
          error: `"${name}" is larger than ${mb} MB, so it was attached by name only (model cannot see the image).`,
        });
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      const dataUrl = `data:${mimeType};base64,${buf.toString("base64")}`;
      return NextResponse.json({
        attachment: {
          id,
          name,
          kind: "image",
          mime: mimeType,
          size: blob.size,
          dataUrl,
        },
      });
    }

    if (
      isTextFile(name, mimeType) ||
      mimeType === "application/json" ||
      mimeType === "application/xml" ||
      mimeType.startsWith("text/")
    ) {
      const text = await blob.text();
      const capped =
        text.length > 120_000
          ? text.slice(0, 120_000) + "\n\n[… truncated]"
          : text;
      return NextResponse.json({
        attachment: {
          id,
          name,
          kind: "text",
          mime: mimeType || "text/plain",
          size: capped.length,
          text: capped,
        },
      });
    }

    if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
      // Only embed moderately sized PDFs. Huge base64 blobs in the browser
      // freeze the chat composer (see attachment-payloads side store).
      if (blob.size > MAX_EMBEDDED_FILE_BYTES) {
        const mb = (MAX_EMBEDDED_FILE_BYTES / (1024 * 1024)).toFixed(1);
        return NextResponse.json({
          attachment: {
            id,
            name,
            kind: "file",
            mime: "application/pdf",
            size: blob.size,
          },
          error: `"${name}" is larger than ${mb} MB, so it was attached by name only (model cannot read the PDF bytes).`,
        });
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      const dataUrl = `data:application/pdf;base64,${buf.toString("base64")}`;
      return NextResponse.json({
        attachment: {
          id,
          name,
          kind: "file",
          mime: "application/pdf",
          size: blob.size,
          dataUrl,
        },
      });
    }

    if (isOfficeFile(name, mimeType)) {
      const buf = Buffer.from(await blob.arrayBuffer());
      try {
        const text = await extractOfficeText(buf, name, mimeType);
        if (text) {
          return NextResponse.json({
            attachment: {
              id,
              name,
              kind: "text",
              mime: "text/plain",
              size: text.length,
              text,
            },
          });
        }
      } catch (err) {
        console.error("[drive/download] office extract", err);
      }
      return NextResponse.json({
        attachment: {
          id,
          name,
          kind: "file",
          mime: mimeType,
          size: blob.size,
        },
        error: `"${name}" couldn't be read as text. Convert to Google Docs/Slides or paste the content.`,
      });
    }

    return NextResponse.json({
      attachment: {
        id,
        name,
        kind: "file",
        mime: mimeType,
        size: blob.size,
      },
      error: `"${name}" was attached by name only (unsupported file type for model reading).`,
    });
  } catch (err) {
    console.error("[drive/download]", err);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json({
      attachment: { id, name, kind: "file", mime: mimeType, size: 0 },
      error: isAbort
        ? `Download of "${name}" timed out.`
        : err instanceof Error
          ? err.message
          : "Unknown download error",
    });
  }
}
