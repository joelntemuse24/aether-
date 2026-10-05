/**
 * Vercel side of native web_search and sandbox file publish.
 * Verifies the turn token, then runs the same search and artifact helpers as live chat.
 * Do not import this file from src/agent-server.
 */

import { fileToolResult, type FileToolResult } from "@/lib/artifacts/file-result";
import { saveArtifact } from "@/lib/artifacts/store";
import { isCloudDbConfigured } from "@/lib/db";
import type { WebSearchOutput } from "@/lib/tools";
import { runWebSearch } from "@/lib/web-search";
import { isSafePublishedFilename } from "./publish-files";
import { verifyTurnToken } from "./turn-token";

export const NATIVE_SEARCH_TOOL = "web_search";
export const NATIVE_PUBLISH_TOOL = "publish_native_file";

export function isNativeCallbackTool(name: string): boolean {
  return name === NATIVE_SEARCH_TOOL || name === NATIVE_PUBLISH_TOOL;
}

type SaveArtifact = typeof saveArtifact;

export type NativeCallbackResult =
  | { kind: "not-turn" }
  | { kind: "denied" }
  | { kind: "ok"; body: WebSearchOutput | FileToolResult | { ok: false; error: string } };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function argsOf(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function dataUrlBuffer(dataUrl: string): Buffer | null {
  const match = /^data:([^,]*);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return null;
  const buffer = Buffer.from((match[2] ?? "").replace(/\s/g, ""), "base64");
  if (buffer.length === 0 || buffer.length > 1_500_000) return null;
  return buffer;
}

export async function executeTurnNativeCallback(input: {
  authorization: string | null;
  secret: string;
  name: string;
  args: unknown;
  search?: (query: string) => Promise<WebSearchOutput>;
  save?: SaveArtifact;
  cloudDb?: boolean;
}): Promise<NativeCallbackResult> {
  const match = /^Bearer\s+(.+)$/i.exec(input.authorization?.trim() || "");
  const token = match?.[1]?.trim() ?? "";
  const claims = await verifyTurnToken(token, input.secret);
  if (!claims) return { kind: "not-turn" };
  const searchAllowed = input.name === NATIVE_SEARCH_TOOL && claims.tools.includes(NATIVE_SEARCH_TOOL);
  const publishAllowed =
    input.name === NATIVE_PUBLISH_TOOL &&
    (claims.tools.includes("sandbox_exec") || claims.tools.includes("sandbox_files"));
  if (!searchAllowed && !publishAllowed) return { kind: "denied" };

  if (input.name === NATIVE_SEARCH_TOOL) {
    const query = text(argsOf(input.args).query).trim();
    if (!query) return { kind: "ok", body: { ok: false, error: "Empty search query." } };
    try {
      const output = await (input.search ?? runWebSearch)(query);
      if (!output.ok) {
        return { kind: "ok", body: { ok: false, error: output.error || "Search failed." } };
      }
      return { kind: "ok", body: output };
    } catch {
      return { kind: "ok", body: { ok: false, error: "Search failed." } };
    }
  }

  if (input.name === NATIVE_PUBLISH_TOOL) {
    const args = argsOf(input.args);
    const filename = text(args.filename).trim();
    const mime = text(args.mime).trim() || "application/octet-stream";
    const dataUrl = text(args.dataUrl);
    if (!isSafePublishedFilename(filename)) {
      return { kind: "ok", body: { ok: false, error: "That file cannot be published." } };
    }
    const buffer = dataUrlBuffer(dataUrl);
    if (!buffer) return { kind: "ok", body: { ok: false, error: "That file cannot be published." } };
    const title = filename.split("/").pop() || filename;
    const cloud = input.cloudDb ?? isCloudDbConfigured();
    let saved: { id?: string; persisted: boolean } = { persisted: false };
    if (claims.canPersist && cloud) {
      const save = input.save ?? saveArtifact;
      try {
        const row = await save(claims.sub, {
          kind: "file",
          title,
          language: filename,
          content: dataUrl,
          projectId: claims.projectId,
          conversationId: claims.conversationId,
          producedBy: [NATIVE_PUBLISH_TOOL],
        });
        saved = { id: row.id, persisted: true };
      } catch {
        saved = { persisted: false };
      }
    }
    return {
      kind: "ok",
      body: fileToolResult({
        title,
        filename,
        mime,
        bytes: buffer.length,
        dataUrl,
        saved,
      }),
    };
  }

  return { kind: "denied" };
}
