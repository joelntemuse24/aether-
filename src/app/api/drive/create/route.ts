import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidDriveAccessToken } from "@/lib/drive-session";

export const runtime = "nodejs";

const MAX_CONTENT_BYTES = 5 * 1024 * 1024;

function extensionForMime(mimeType: string): string {
  if (mimeType === "text/markdown") return ".md";
  if (mimeType === "application/json") return ".json";
  if (mimeType === "text/html") return ".html";
  if (mimeType === "text/csv") return ".csv";
  return ".txt";
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
    name?: string;
    content?: string;
    mimeType?: string;
  };
  const content = typeof body.content === "string" ? body.content : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (new TextEncoder().encode(content).byteLength > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "This artifact is too large to save to Drive." },
      { status: 413 },
    );
  }

  const mimeType = body.mimeType || "text/plain";
  const baseName = (body.name || "artifact").trim() || "artifact";
  const name = /\.[a-z0-9]{1,8}$/i.test(baseName)
    ? baseName
    : `${baseName}${extensionForMime(mimeType)}`;
  const metadata = JSON.stringify({ name, mimeType });
  const boundary = `aether-${crypto.randomUUID()}`;
  const multipart = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n`,
    `--${boundary}--\r\n`,
  ].join("");

  const driveRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    },
  );

  if (!driveRes.ok) {
    console.error("[drive/create]", driveRes.status, await driveRes.text().catch(() => ""));
    return NextResponse.json(
      { error: "Could not save this artifact to Drive." },
      { status: driveRes.status >= 500 ? 502 : driveRes.status },
    );
  }

  const file = (await driveRes.json()) as {
    id: string;
    name: string;
    webViewLink?: string;
  };
  return NextResponse.json({ file });
}
