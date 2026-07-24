/**
 * Google Drive Picker + download helpers.
 * Requires a Google Cloud OAuth 2.0 Client ID (Web application)
 * with the Google Picker API and Google Drive API enabled.
 */

import type { PendingAttachment } from "./attachments";
import { isImageFile, isTextFile } from "./attachments";

/* ─── Minimal ambient types for the Google scripts we load at runtime ─── */

type GapiClient = {
  load: (libraries: string, callback: () => void) => void;
};

type GoogleAccountsOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: { access_token?: string; error?: string }) => void;
  }) => {
    requestAccessToken: (opts: { prompt?: string }) => void;
  };
};

type GooglePickerDocsView = {
  setIncludeFolders: (v: boolean) => GooglePickerDocsView;
  setSelectFolderEnabled: (v: boolean) => GooglePickerDocsView;
};

type GooglePickerBuilder = {
  addView: (view: GooglePickerDocsView) => GooglePickerBuilder;
  enableFeature: (feature: string) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerCallbackData) => void) => GooglePickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

type GooglePickerCallbackData = {
  action: string;
  docs?: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes?: string;
    url?: string;
  }>;
};

type GooglePickerNamespace = {
  DocsView: new (viewId?: string) => GooglePickerDocsView;
  PickerBuilder: new () => GooglePickerBuilder;
  ViewId: { DOCS_IMAGES: string; PDFS: string };
  Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
};

type GoogleNamespace = {
  accounts: { oauth2: GoogleAccountsOauth2 };
  picker: GooglePickerNamespace;
};

declare global {
  interface Window {
    gapi: GapiClient;
    google: GoogleNamespace;
  }
}

const SCOPES = "https://www.googleapis.com/auth/drive.readonly";

let gapiLoaded = false;
let gisLoaded = false;
let tokenClient: {
  requestAccessToken: (opts: { prompt?: string }) => void;
} | null = null;
let currentClientId: string | null = null;
let pendingTokenCallback: ((token: string) => void) | null = null;

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
  if (gapiLoaded && gisLoaded && window.gapi && window.google) {
    return;
  }

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

function ensureTokenClient(clientId: string) {
  if (tokenClient && currentClientId === clientId) return;

  currentClientId = clientId;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp) => {
      const cb = pendingTokenCallback;
      pendingTokenCallback = null;
      if (resp.error || !resp.access_token) {
        console.error("[google-drive] token error", resp);
        return;
      }
      if (cb) cb(resp.access_token);
    },
  });
}

/** Request an access token and run the callback when it arrives. */
export function requestAccessToken(
  clientId: string,
  onToken: (token: string) => void,
): void {
  ensureTokenClient(clientId);
  if (!tokenClient) throw new Error("Token client not initialized");
  pendingTokenCallback = onToken;
  tokenClient.requestAccessToken({ prompt: "" });
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
  onCancel?: () => void,
): void {
  const view = new window.google.picker.DocsView()
    .setIncludeFolders(false)
    .setSelectFolderEnabled(false);

  const picker = new window.google.picker.PickerBuilder()
    .addView(view)
    .addView(
      new window.google.picker.DocsView(window.google.picker.ViewId.DOCS_IMAGES),
    )
    .addView(new window.google.picker.DocsView(window.google.picker.ViewId.PDFS))
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .setOAuthToken(accessToken)
    .setCallback((data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        const docs: PickerDoc[] = (data.docs || []).map((d) => ({
          id: d.id,
          name: d.name,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          url: d.url,
        }));
        onPicked(docs);
      } else if (data.action === window.google.picker.Action.CANCEL) {
        onCancel?.();
      }
    })
    .build();

  picker.setVisible(true);
}

async function fetchWithAuth(
  url: string,
  accessToken: string,
): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return res;
}

/** Download a Drive file and turn it into a PendingAttachment. */
export async function downloadDriveFile(
  fileId: string,
  name: string,
  mimeType: string,
  accessToken: string,
): Promise<{ attachment: PendingAttachment | null; error?: string }> {
  const id = crypto.randomUUID();

  const isGoogleDoc =
    mimeType === "application/vnd.google-apps.document" ||
    mimeType === "application/vnd.google-apps.spreadsheet" ||
    mimeType === "application/vnd.google-apps.presentation" ||
    mimeType === "application/vnd.google-apps.drawing";

  try {
    if (isGoogleDoc) {
      // Prefer useful export formats
      let exportMime = "text/plain";
      let ext = ".txt";
      if (mimeType.includes("spreadsheet")) {
        exportMime = "text/csv";
        ext = ".csv";
      } else if (mimeType.includes("presentation")) {
        exportMime = "text/plain";
        ext = ".txt";
      } else if (mimeType.includes("document")) {
        // plain text is most reliable for LLM context
        exportMime = "text/plain";
        ext = ".txt";
      }

      const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`;
      const res = await fetchWithAuth(exportUrl, accessToken);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[google-drive] export failed", res.status, body);
        // Fallback: still attach a note so the user sees something
        return {
          attachment: {
            id,
            name,
            kind: "file",
            mime: mimeType,
            size: 0,
          },
          error: `Could not export "${name}" (${res.status}). It was attached as a reference only.`,
        };
      }

      const text = await res.text();
      const capped =
        text.length > 120_000
          ? text.slice(0, 120_000) + "\n\n[… truncated]"
          : text;

      return {
        attachment: {
          id,
          name: name.endsWith(ext) ? name : name + ext,
          kind: "text",
          mime: exportMime,
          size: capped.length,
          text: capped,
        },
      };
    }

    // Regular binary / uploaded files
    const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetchWithAuth(mediaUrl, accessToken);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[google-drive] media download failed", res.status, body);
      return {
        attachment: {
          id,
          name,
          kind: "file",
          mime: mimeType,
          size: 0,
        },
        error: `Could not download "${name}" (${res.status}). Attached as a reference only.`,
      };
    }

    if (isImageFile(mimeType)) {
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read image"));
        reader.readAsDataURL(blob);
      });
      return {
        attachment: {
          id,
          name,
          kind: "image",
          mime: mimeType,
          size: blob.size,
          dataUrl,
        },
      };
    }

    // Treat many types as text if possible
    if (
      isTextFile(name, mimeType) ||
      mimeType === "application/json" ||
      mimeType === "application/xml" ||
      mimeType.startsWith("text/")
    ) {
      const text = await res.text();
      const capped =
        text.length > 120_000
          ? text.slice(0, 120_000) + "\n\n[… truncated]"
          : text;
      return {
        attachment: {
          id,
          name,
          kind: "text",
          mime: mimeType || "text/plain",
          size: capped.length,
          text: capped,
        },
      };
    }

    // PDF and other binaries — attach as a named reference for now
    // (full binary upload to the model would need base64 + provider support)
    return {
      attachment: {
        id,
        name,
        kind: "file",
        mime: mimeType,
        size: Number(res.headers.get("content-length") || 0),
      },
    };
  } catch (err) {
    console.error("[google-drive] download error", err);
    const message =
      err instanceof Error ? err.message : "Unknown download error";
    return {
      attachment: {
        id,
        name,
        kind: "file",
        mime: mimeType,
        size: 0,
      },
      error: `"${name}": ${message}`,
    };
  }
}

export function isGoogleApisReady(): boolean {
  return gapiLoaded && gisLoaded;
}
