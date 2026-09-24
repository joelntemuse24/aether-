/** Local TrueForge sidecar. Only the Next server talks to it. */
export const TRUEFORGE_PORT = Number(process.env.TRUEFORGE_PORT || 8790);

export function trueforgeOrigin(): string {
  return `http://127.0.0.1:${TRUEFORGE_PORT}`;
}

/** Set `AETHER_TRUEFORGE=0` to skip the sidecar (legacy Trigger / in-process chat). */
export function trueforgeSidecarEnabled(): boolean {
  return process.env.AETHER_TRUEFORGE !== "0";
}
