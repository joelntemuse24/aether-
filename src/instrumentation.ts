/**
 * The TrueForge sidecar is started by `src/lib/trueforge/dev-server.ts`
 * (`npm run dev` / `npm run start`), not from this hook. Importing the
 * sidecar here pulls Node builtins into the Next client compile.
 */
export async function register() {
  return;
}
