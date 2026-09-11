/**
 * Social-feed stub. No scrape path. Official API key required — and even
 * then this slice does not call a network.
 */

export const SOCIAL_UNAVAILABLE_MESSAGE =
  "Social feed search is unavailable without an official API key.";

export async function searchSocialFeed(
  _input: { query: string },
  _env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<{ ok: false; error: string }> {
  void _input;
  void _env;
  return { ok: false, error: SOCIAL_UNAVAILABLE_MESSAGE };
}
