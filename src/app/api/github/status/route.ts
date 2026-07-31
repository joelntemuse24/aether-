import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearGitHubCookie,
  getValidGitHubAccessToken,
  readGitHubCookie,
} from "@/lib/github-session";

function githubConfigured(): boolean {
  return Boolean(
    (process.env.GITHUB_CLIENT_ID || process.env.AUTH_GITHUB_ID) &&
      (process.env.GITHUB_CLIENT_SECRET || process.env.AUTH_GITHUB_SECRET),
  );
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email;

  if (!userId) {
    return NextResponse.json({ connected: false, authenticated: false });
  }

  const stored = await readGitHubCookie();
  if (!stored || stored.userId !== userId) {
    return NextResponse.json({
      connected: false,
      authenticated: true,
      githubConfigured: githubConfigured(),
    });
  }

  const valid = await getValidGitHubAccessToken(userId);
  if (!valid) {
    return NextResponse.json({
      connected: false,
      authenticated: true,
      githubConfigured: githubConfigured(),
    });
  }

  // Soft-validate token against GitHub
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${valid.accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Aether",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (res.status === 401) {
      await clearGitHubCookie();
      return NextResponse.json({
        connected: false,
        authenticated: true,
        githubConfigured: true,
      });
    }
    if (res.ok) {
      const info = (await res.json()) as {
        login?: string;
        name?: string | null;
      };
      return NextResponse.json({
        connected: true,
        authenticated: true,
        login: info.login || valid.login || null,
        name: info.name || valid.name || null,
        githubConfigured: true,
      });
    }
  } catch {
    // Fall through with cookie data
  }

  return NextResponse.json({
    connected: true,
    authenticated: true,
    login: valid.login || null,
    name: valid.name || null,
    githubConfigured: true,
  });
}
