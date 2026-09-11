/**
 * Read-only design-file connector. Token stays on the server.
 * User-facing copy never names the upstream.
 */

export const DESIGN_UNAVAILABLE_MESSAGE = "Design files are not connected.";

export type DesignListResult =
  | { ok: true; files: Array<{ key: string; title: string }>; hint?: string }
  | { ok: false; error: string };

export type DesignReadResult =
  | { ok: true; title: string; lastModified?: string; pages: string[] }
  | { ok: false; error: string };

function envToken(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  return (
    (env.AETHER_DESIGN_TOKEN || env.FIGMA_ACCESS_TOKEN || "").trim()
  );
}

export function isDesignConnected(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return envToken(env).length > 0;
}

export async function listDesignFiles(
  input: { query?: string; teamId?: string },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  deps?: { fetchImpl?: typeof fetch },
): Promise<DesignListResult> {
  const token = envToken(env);
  if (!token) return { ok: false, error: DESIGN_UNAVAILABLE_MESSAGE };
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const teamId = (input.teamId || env.AETHER_DESIGN_TEAM_ID || "").trim();
  if (!teamId) {
    return {
      ok: true,
      files: [],
      hint: "Pass a file key to read a specific design. Listing needs a team id from the operator.",
    };
  }
  try {
    const res = await fetchImpl(
      `https://api.figma.com/v1/teams/${encodeURIComponent(teamId)}/projects`,
      { headers: { "X-Figma-Token": token } },
    );
    if (!res.ok) return { ok: false, error: DESIGN_UNAVAILABLE_MESSAGE };
    const body = (await res.json()) as {
      projects?: Array<{ id: string; name: string }>;
    };
    const q = (input.query || "").trim().toLowerCase();
    const files = (body.projects ?? [])
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => ({ key: p.id, title: p.name }));
    return { ok: true, files };
  } catch {
    return { ok: false, error: DESIGN_UNAVAILABLE_MESSAGE };
  }
}

export async function readDesignFile(
  input: { fileKey: string },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  deps?: { fetchImpl?: typeof fetch },
): Promise<DesignReadResult> {
  const token = envToken(env);
  if (!token) return { ok: false, error: DESIGN_UNAVAILABLE_MESSAGE };
  const fileKey = input.fileKey.trim();
  if (!fileKey) return { ok: false, error: "A design file key is required." };
  const fetchImpl = deps?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=1`,
      { headers: { "X-Figma-Token": token } },
    );
    if (!res.ok) return { ok: false, error: "Could not read that design file." };
    const body = (await res.json()) as {
      name?: string;
      lastModified?: string;
      document?: { children?: Array<{ name?: string }> };
    };
    const pages = (body.document?.children ?? [])
      .map((child) => child.name || "")
      .filter(Boolean);
    return {
      ok: true,
      title: body.name || "Design file",
      lastModified: body.lastModified,
      pages,
    };
  } catch {
    return { ok: false, error: "Could not read that design file." };
  }
}
