/**
 * Phase-1 seam between Hermes-native tools and Aether-owned side effects.
 *
 * Hermes owns web / fetch / code / sandbox. Aether still owns memory storage,
 * Drive, GitHub, persisted artifacts, and confirm cards. Those are not MCP
 * tools on Hermes yet — they stay on Vercel (prompt injection + existing
 * `/api/*` routes). Do not invent Aether tool names on the Hermes path.
 */

export type HermesToolSeamContext = {
  toolsEnabled: boolean;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
};

export function hermesAetherToolSeamAddendum(
  ctx: HermesToolSeamContext,
): string {
  const lines = [
    "## Aether context (this turn)",
    "You are answering through Aether. A remote agent host owns web search, page fetch, code execution, and sandbox files. Use those when they improve accuracy.",
    "Aether-specific side effects are not live tools this turn:",
    "- Memory: relevant notes are already in this prompt. Do not invent a memory tool. If the user asks to remember something, say it will persist after they save it in Aether.",
    "- Artifacts: write long or reusable work as markdown in your reply so the user can save it from the Aether panel.",
    "- Confirmations: if an action is destructive, spends money, or submits a form, say so clearly and wait. Do not claim a Hermes approval channel already confirmed it.",
  ];

  if (ctx.hasMemory) {
    lines.push(
      "- The user's curated memory (if any) is injected below. Treat it as already retrieved.",
    );
  }
  if (ctx.hasDrive) {
    lines.push(
      "- Google Drive is connected on Aether, but Drive search/read is not a live tool this turn. Ask the user to paste file text, or note that Drive tools return in a later slice.",
    );
  }
  if (ctx.hasGitHub) {
    lines.push(
      "- GitHub is connected on Aether, but repo read tools are not live this turn. Ask the user to paste the file, or use a public fetch if the repo is public.",
    );
  }
  if (!ctx.toolsEnabled) {
    lines.push("The user turned tools off — answer in text only.");
  }

  return lines.join("\n");
}

/** Verify policy without naming the local `verify_checklist` tool. */
export function hermesSafeVerifyAddendum(verifyBlock: string | null): string | null {
  if (!verifyBlock) return null;
  return [
    "## Verify phase (required)",
    "Before your final user-facing answer on substantial work:",
    "1. Include a short written checklist (facts cited, prompt covered, tone/format, risks).",
    "2. If checks fail, fix or be explicit about limits — do not silently ship a weak draft.",
    "3. Put long deliverables in markdown so the user can save them from the Aether artifact panel.",
  ].join("\n");
}
