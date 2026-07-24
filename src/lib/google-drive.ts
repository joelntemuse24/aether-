/**
 * Google Drive Picker + download helpers.
 * Requires a Google Cloud OAuth 2.0 Client ID (Web application)
 * with the Google Picker API and Google Drive API enabled.
 */

import type { PendingAttachment } from "./attachments";
import { isImageFile, isTextFile } from "./attachments";

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

let gapiLoaded = false;
let gisLoaded = false;
let tokenClient: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export async function loadGoogleApis(): Promise<void> {
  await Promise.all([
    loadScript("https://apis.google.com/js/api.js"),
    loadScript("https://accounts.google.com/gsi/client"),
  ]);

  await new Promise<void>((resolve) => {
    window.gapi.load("client:picker", () => {
      gapiLoaded = true;
      resolve();
    });
  });

  gisLoaded = true;
}

export function initTokenClient(clientId: string, callback: (token: string) => void) {
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp: any) => {
      if (resp.error) {
        console.error("[google-drive] token error", resp);
        return;
      }
      callback(resp.access_token);
    },
  });
}

export function requestAccessToken(prompt: "" | "consent" = ""): void {
  if (!tokenClient) throw new Error("Token client not initialized");
  tokenClient.requestAccessToken({ prompt });
}

type PickerDoc = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: string;
  url?: string;
};

export function openPicker(
  accessToken: string,
  onPicked: (docs: PickerDoc[]) => void,
): void {
  const view = new window.google.picker.DocsView()
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false);

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .addView(new window.google.picker.DocsView(window.google.picker.ViewId.DOCS_IMAGES))
    .addView(new window.google.picker.DocsView(window.google.picker.ViewId.PDFS))
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .setOAuthToken(accessToken)
    .setCallback((data: any) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const docs: PickerDoc[] = (data.docs || []).map((d: any) => ({
          id: d.id,
          name: d.name,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          url: d.url,
        }));
        onPicked(docs);
      }
    })
    .build();

  picker.setVisible(true);
}

/** Download a Drive file and turn it into a PendingAttachment. */
export async function downloadDriveFile(
  fileId: string,
  name: string,
  mimeType: string,
  accessToken: string,
): Promise<PendingAttachment | null> {
  const id = crypto.randomUUID();

  // Google-native formats need export
  const isGoogleDoc =
    mimeType === "application/vnd.google-apps.document" ||
    mimeType === "application/vnd.google-apps.spreadsheet" ||
    mimeType === "application/vnd.google-apps.presentation";

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
      } else {
        // Docs → markdown-ish plain text
        exportMime = "text/plain";
        ext = ".txt";
      }

      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const text = await res.text();
      const capped =
        text.length > 120_000 ? text.slice(0, 120_000) + "\n\n[… truncated]" : text;

      return {
        id,
        name: name.endsWith(ext) ? name : name + ext,
        kind: "text",
        mime: exportMime,
        size: capped.length,
        text: capped,
      };
    }

    // Regular binary / text files
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    if (isImageFile(mimeType)) {
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(blob);
      });
      return {
        id,
        name,
        kind: "image",
        mime: mimeType,
        size: blob.size,
        dataUrl,
      };
    }

    if (isTextFile(name, mimeType)) {
      const text = await res.text();
      const capped =
        text.length > 120_000 ? text.slice(0, 120_000) + "\n\n[… truncated]" : text;
      return {
        id,
        name,
        kind: "text",
        mime: mimeType,
        size: capped.length,
        text: capped,
      };
    }

    // Other files (PDF etc.) – keep as generic file reference for now
    return {
      id,
      name,
      kind: "file",
      mime: mimeType,
      size: Number(res.headers.get("content-length") || 0),
    };
  } catch (err) {
    console.error("[google-drive] download error", err);
    return null;
  }
}

export function isGoogleApisReady(): boolean {
  return gapiLoaded && gisLoaded;
}
