import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearGitHubCookie, readGitHubCookie } from "@/lib/github-session";

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const stored = await readGitHubCookie();
  if (stored && stored.userId === userId) {
    // Best-effort revoke (GitHub OAuth App)
    const clientId = process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID;
    const clientSecret =
      process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET;
    if (clientId && clientSecret && stored.accessToken) {
      try {
        await fetch(
          `https://api.github.com/applications/${clientId}/token`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "Aether",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({ access_token: stored.accessToken }),
          },
        );
      } catch {
        // ignore
      }
    }
  }

  await clearGitHubCookie();
  return NextResponse.json({ ok: true });
}
