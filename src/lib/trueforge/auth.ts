import { timingSafeEqual } from "node:crypto";

/** True when `Authorization: Bearer <token>` matches the shared secret. */
export function bearerMatches(header: string | undefined, expected: string): boolean {
  const secret = expected.trim();
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length).trim());
  const want = Buffer.from(secret);
  if (got.length !== want.length || got.length === 0) return false;
  return timingSafeEqual(got, want);
}
