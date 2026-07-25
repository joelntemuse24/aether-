/**
 * Encrypted httpOnly cookie for Google Drive OAuth tokens.
 * Kept separate from the Auth.js session so Drive can be connected
 * after signing in with any provider.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const DRIVE_COOKIE = "aether.drive";
const DRIVE_PURPOSE = "aether-drive-tokens";
const DRIVE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type DriveTokenPayload = {
  userId: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
  email?: string;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function encryptDriveTokens(
  payload: DriveTokenPayload,
): Promise<string> {
  return new SignJWT({ ...payload, purpose: DRIVE_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DRIVE_COOKIE_MAX_AGE}s`)
    .sign(getSecret());
}

export async function decryptDriveTokens(
  token: string,
): Promise<DriveTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.purpose !== DRIVE_PURPOSE) return null;
    if (
      typeof payload.userId !== "string" ||
      typeof payload.refreshToken !== "string" ||
      typeof payload.accessToken !== "string" ||
      typeof payload.expiresAt !== "number"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      refreshToken: payload.refreshToken,
      accessToken: payload.accessToken,
      expiresAt: payload.expiresAt,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    return null;
  }
}

export async function setDriveCookie(payload: DriveTokenPayload): Promise<void> {
  const value = await encryptDriveTokens(payload);
  const jar = await cookies();
  jar.set(DRIVE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DRIVE_COOKIE_MAX_AGE,
  });
}

export async function clearDriveCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(DRIVE_COOKIE);
}

export async function readDriveCookie(): Promise<DriveTokenPayload | null> {
  const jar = await cookies();
  const raw = jar.get(DRIVE_COOKIE)?.value;
  if (!raw) return null;
  return decryptDriveTokens(raw);
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID;
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    console.error("[drive] token refresh failed", res.status, await res.text());
    return null;
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
}

/**
 * Return a valid Drive access token for the given user, refreshing if needed.
 * Returns null if Drive is not connected or refresh fails.
 */
export async function getValidDriveAccessToken(
  userId: string,
): Promise<{ accessToken: string; email?: string } | null> {
  const stored = await readDriveCookie();
  if (!stored || stored.userId !== userId) return null;

  if (stored.accessToken && Date.now() < stored.expiresAt) {
    return { accessToken: stored.accessToken, email: stored.email };
  }

  const refreshed = await refreshGoogleAccessToken(stored.refreshToken);
  if (!refreshed) {
    await clearDriveCookie();
    return null;
  }

  await setDriveCookie({
    ...stored,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  });

  return { accessToken: refreshed.accessToken, email: stored.email };
}
