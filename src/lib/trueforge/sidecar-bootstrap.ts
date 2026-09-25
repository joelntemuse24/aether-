import { pruneOldSandboxes, trueforgeSandboxDir } from "./sandbox-prune";
import { applyTrueForgeSidecarPatches } from "./sidecar-patch";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Apply the TrueForge package patch and start sandbox pruning.
 * External VM launchers should call this before starting the sidecar.
 */
export function prepareSidecar(root = process.cwd()): string[] {
  const patched = applyTrueForgeSidecarPatches(root);
  if (patched.length) console.info("[aether] Patched TrueForge", patched.join(", "));
  const sandboxes = trueforgeSandboxDir();
  const prune = () => {
    void pruneOldSandboxes(sandboxes).then((removed) => {
      if (removed.length) console.info("[aether] Pruned sandboxes", removed.length);
    });
  };
  prune();
  const timer = setInterval(prune, PRUNE_INTERVAL_MS);
  timer.unref();
  return patched;
}
