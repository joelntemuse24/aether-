export const GUEST_FILE_HINT =
  "This file is available to download in this thread. Sign in to keep it in your account.";

export function artifactDownloadPath(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return "";
  return `/api/artifacts/${encodeURIComponent(trimmed)}/download`;
}

export type FilePersistState = {
  id?: string;
  persisted: boolean;
};

export type FileToolResultInput = {
  title: string;
  filename: string;
  mime: string;
  bytes: number;
  dataUrl: string;
  saved: FilePersistState;
  extra?: Record<string, unknown>;
};

export type FileToolResult = {
  ok: true;
  kind: "file";
  title: string;
  filename: string;
  mime: string;
  bytes: number;
  persisted: boolean;
  id?: string;
  downloadPath?: string;
  content?: string;
  hint?: string;
  [key: string]: unknown;
};

/**
 * Shape a downloadable office file for the thread.
 * Signed-in + cloud: persist bytes and return a download path (not a data URL
 * the panel cannot fetch). Guests keep the data URL in-thread and a sign-in
 * hint — never "attached" with no file.
 */
export function fileToolResult(input: FileToolResultInput): FileToolResult {
  const base: FileToolResult = {
    ok: true,
    kind: "file",
    title: input.title,
    filename: input.filename,
    mime: input.mime,
    bytes: input.bytes,
    persisted: input.saved.persisted,
    ...input.extra,
  };
  if (input.saved.persisted && input.saved.id) {
    return {
      ...base,
      id: input.saved.id,
      downloadPath: artifactDownloadPath(input.saved.id),
    };
  }
  return {
    ...base,
    id: input.saved.id,
    content: input.dataUrl,
    hint: GUEST_FILE_HINT,
  };
}
