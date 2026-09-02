import { refreshGoogleAccessToken } from "@/lib/drive-session";
import type { AgentContextPayload } from "./context-token";

export async function driveAccessFromAgentContext(
  ctx: AgentContextPayload,
): Promise<string | undefined> {
  if (
    ctx.driveAccessToken &&
    (!ctx.driveExpiresAt || Date.now() < ctx.driveExpiresAt)
  ) {
    return ctx.driveAccessToken;
  }
  if (!ctx.driveRefreshToken) return ctx.driveAccessToken;
  const refreshed = await refreshGoogleAccessToken(ctx.driveRefreshToken);
  return refreshed?.accessToken ?? ctx.driveAccessToken;
}
