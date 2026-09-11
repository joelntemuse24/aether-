/**
 * Read-only deployments connector. Uses a dedicated token — never the
 * workspace sandbox access token — so chat cannot list operator deploys.
 * User-facing copy never names the upstream.
 */

export const DEPLOYMENTS_UNAVAILABLE_MESSAGE = "Deployments are not connected.";

export type DeploymentSummary = {
  id: string;
  name?: string;
  url?: string;
  created?: number;
  readyState?: string;
};

export type DeploymentsListResult =
  | { ok: true; deployments: DeploymentSummary[] }
  | { ok: false; error: string };

export type DeploymentReadResult =
  | { ok: true } & DeploymentSummary
  | { ok: false; error: string };

function envToken(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string {
  return (env.AETHER_DEPLOYMENTS_TOKEN || "").trim();
}

export function isDeploymentsConnected(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return envToken(env).length > 0;
}

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export async function listDeployments(
  input: { projectId?: string; limit?: number },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  deps?: { fetchImpl?: typeof fetch },
): Promise<DeploymentsListResult> {
  const token = envToken(env);
  if (!token) return { ok: false, error: DEPLOYMENTS_UNAVAILABLE_MESSAGE };
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const projectId = (
    input.projectId ||
    env.AETHER_DEPLOYMENTS_PROJECT_ID ||
    ""
  ).trim();
  const teamId = (env.AETHER_DEPLOYMENTS_TEAM_ID || "").trim();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set("projectId", projectId);
  if (teamId) params.set("teamId", teamId);
  try {
    const res = await fetchImpl(
      `https://api.vercel.com/v6/deployments?${params.toString()}`,
      { headers: headers(token) },
    );
    if (!res.ok) return { ok: false, error: DEPLOYMENTS_UNAVAILABLE_MESSAGE };
    const body = (await res.json()) as {
      deployments?: Array<{
        uid?: string;
        id?: string;
        name?: string;
        url?: string;
        created?: number;
        readyState?: string;
      }>;
    };
    const deployments = (body.deployments ?? []).map((row) => ({
      id: row.uid || row.id || "",
      name: row.name,
      url: row.url,
      created: row.created,
      readyState: row.readyState,
    })).filter((row) => row.id);
    return { ok: true, deployments };
  } catch {
    return { ok: false, error: DEPLOYMENTS_UNAVAILABLE_MESSAGE };
  }
}

export async function readDeployment(
  input: { id: string },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  deps?: { fetchImpl?: typeof fetch },
): Promise<DeploymentReadResult> {
  const token = envToken(env);
  if (!token) return { ok: false, error: DEPLOYMENTS_UNAVAILABLE_MESSAGE };
  const id = input.id.trim();
  if (!id) return { ok: false, error: "A deployment id is required." };
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const teamId = (env.AETHER_DEPLOYMENTS_TEAM_ID || "").trim();
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  try {
    const res = await fetchImpl(
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}${qs}`,
      { headers: headers(token) },
    );
    if (!res.ok) return { ok: false, error: "Could not read that deployment." };
    const body = (await res.json()) as {
      uid?: string;
      id?: string;
      name?: string;
      url?: string;
      created?: number;
      readyState?: string;
    };
    return {
      ok: true,
      id: body.uid || body.id || id,
      name: body.name,
      url: body.url,
      created: body.created,
      readyState: body.readyState,
    };
  } catch {
    return { ok: false, error: "Could not read that deployment." };
  }
}
