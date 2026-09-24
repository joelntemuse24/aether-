/** Local TrueForge sidecar. The Next app proxies `/api/v1` here. */
export const TRUEFORGE_PORT = Number(process.env.TRUEFORGE_PORT || 8790);

export function trueforgeOrigin(): string {
  return `http://127.0.0.1:${TRUEFORGE_PORT}`;
}

/** Set `AETHER_TRUEFORGE=0` to skip the sidecar (legacy Trigger / `/api/chat` only). */
export function trueforgeSidecarEnabled(): boolean {
  return process.env.AETHER_TRUEFORGE !== "0";
}

/**
 * Chat surface. Default is the themed TrueForge UI.
 * `NEXT_PUBLIC_AETHER_CHAT=legacy` keeps the previous composer and Trigger transport.
 */
export function aetherChatSurface(): "trueforge" | "legacy" {
  return process.env.NEXT_PUBLIC_AETHER_CHAT === "legacy" ? "legacy" : "trueforge";
}
