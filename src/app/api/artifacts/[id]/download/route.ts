import { NextResponse } from "next/server";
import { requireCloudUser } from "@/lib/conversations/auth";
import { getArtifact } from "@/lib/artifacts/store";
import {
  bytesFromArtifactContent,
  downloadFilename,
  fileDownloadHeaders,
} from "@/lib/artifacts/download";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireCloudUser();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const { id } = await params;
  const artifactId = id?.trim();
  if (!artifactId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const artifact = await getArtifact(gate.userId, artifactId);
  if (!artifact) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsed = bytesFromArtifactContent(artifact.content);
  if (!parsed) {
    return NextResponse.json(
      { error: "This file is not available to download." },
      { status: 404 },
    );
  }
  const filename = downloadFilename({
    title: artifact.title,
    language: artifact.language,
    mime: parsed.mime,
  });
  return new NextResponse(new Uint8Array(parsed.buffer), {
    status: 200,
    headers: fileDownloadHeaders(filename, parsed.mime, parsed.buffer.byteLength),
  });
}
