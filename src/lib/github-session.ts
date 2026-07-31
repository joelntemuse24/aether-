/**
 * Encrypted httpOnly cookie for GitHub OAuth tokens (connector).
 * Separate from Auth.js sign-in so GitHub can be connected after any login.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getAuthSecretKey } from "@/lib/auth-secret";

export const GITHUB_COOKIE = "aether.github";
const GITHUB_PURPOSE = "aether-github-tokens";
const GITHUB_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days (OAuth App tokens are long-lived)

export type GitHubTokenPayload = {
  userId: string;
  accessToken: string;
  login?: string;
  name?: string;
};

export async function encryptGitHubTokens(
  payload: GitHubTokenPayload,
): Promise<string> {
  return new SignJWT({ ...payload, purpose: GITHUB_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GITHUB_COOKIE_MAX_AGE}s`)
    .sign(getAuthSecretKey());
}

export async function decryptGitHubTokens(
  token: string,
): Promise<GitHubTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecretKey());
    if (payload.purpose !== GITHUB_PURPOSE) return null;
    if (
      typeof payload.userId !== "string" ||
      typeof payload.accessToken !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      accessToken: payload.accessToken,
      login: typeof payload.login === "string" ? payload.login : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}

export async function setGitHubCookie(
  payload: GitHubTokenPayload,
): Promise<void> {
  const value = await encryptGitHubTokens(payload);
  const jar = await cookies();
  jar.set(GITHUB_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GITHUB_COOKIE_MAX_AGE,
  });
}

export async function clearGitHubCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(GITHUB_COOKIE);
}

export async function readGitHubCookie(): Promise<GitHubTokenPayload | null> {
  const jar = await cookies();
  const raw = jar.get(GITHUB_COOKIE)?.value;
  if (!raw) return null;
  return decryptGitHubTokens(raw);
}

/**
 * Return a valid GitHub access token for the given user.
 * Classic OAuth App tokens don't refresh — on 401 callers should clear the cookie.
 */
export async function getValidGitHubAccessToken(
  userId: string,
): Promise<{ accessToken: string; login?: string; name?: string } | null> {
  const stored = await readGitHubCookie();
  if (!stored || stored.userId !== userId || !stored.accessToken) return null;
  return {
    accessToken: stored.accessToken,
    login: stored.login,
    name: stored.name,
  };
}
