import { bearerMatches } from "@/lib/trueforge/auth";
import { trueforgeToken } from "@/lib/trueforge/config";
import { handleTrueForgeMcpRpc } from "@/lib/trueforge/mcp-http";
import { readTrueForgeToolContext } from "@/lib/trueforge/tool-context";

export const maxDuration = 60;

type Rpc = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

export async function POST(req: Request) {
  const token = trueforgeToken();
  if (!token || !bearerMatches(req.headers.get("authorization") ?? undefined, token)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const ctx = readTrueForgeToolContext(req.headers.get("x-aether-tool-context"), token);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }
  if (Array.isArray(body)) {
    const replies = [];
    for (const message of body) {
      const reply = await handleTrueForgeMcpRpc(message as Rpc, ctx);
      if (reply) replies.push(reply);
    }
    if (!replies.length) return new Response(null, { status: 202 });
    return Response.json(replies);
  }
  const reply = await handleTrueForgeMcpRpc(body as Rpc, ctx);
  if (!reply) return new Response(null, { status: 202 });
  return Response.json(reply);
}

export function GET() {
  return new Response(null, { status: 405 });
}
