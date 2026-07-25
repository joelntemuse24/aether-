import { SignJWT, jwtVerify } from "jose";
import { getAuthSecretKey } from "@/lib/auth-secret";

const MAGIC_PURPOSE = "aether-email-magic";
const MAGIC_TTL_SECONDS = 60 * 15; // 15 minutes

export async function createMagicLinkToken(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  return new SignJWT({ email: normalized, purpose: MAGIC_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAGIC_TTL_SECONDS}s`)
    .sign(getAuthSecretKey());
}

export async function verifyMagicLinkToken(
  token: string,
): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecretKey());
    if (payload.purpose !== MAGIC_PURPOSE) return null;
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) return null;
    return { email };
  } catch {
    return null;
  }
}
