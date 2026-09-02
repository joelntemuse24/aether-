/**
 * Worker-side callback into Vercel for Aether-owned tools.
 * Drive/GitHub cookies never travel with this request — only the opaque context JWT.
 */

import { aetherAppOrigin } from "./app-url";

export async function executeAetherToolViaCallback(input: {
  name: string;
  args: unknown;
  contextToken: string;
  origin?: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const origin = (input.origin || aetherAppOrigin()).replace(/\/+$/, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  const res = await fetchImpl(`${origin}/api/hermes/aether-tools`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.contextToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      arguments: input.args,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      error: text.slice(0, 400) || `Aether tool failed (${res.status})`,
    };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: "Aether tool returned invalid JSON." };
  }
}
