/**
 * Phase-3 seam between remote-host native tools and Aether-owned side effects.
 *
 * The remote agent host owns web / fetch / code / sandbox. Aether owns memory
 * storage, Drive, GitHub, persisted artifacts, and confirm cards. Those execute
 * on Vercel via the Aether tool dispatcher (callback + same-turn loop).
 * Do not wire them as in-process streamText tools on the hosted path.
 */

import { AETHER_TOOL_FENCE_CLOSE, AETHER_TOOL_FENCE_OPEN } from "./aether-tool-fence";

export type HermesToolSeamContext = {
  toolsEnabled: boolean;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
  canPersistArtifacts?: boolean;
  approvalMode?: "ask" | "auto";
};

export function hermesAetherToolSeamAddendum(
  ctx: HermesToolSeamContext,
): string {
  const live: string[] = [];
  if (ctx.hasMemory) {
    live.push(
      "- memory_search: search the user's curated long-term memory.",
      "- memory_write: save a lasting fact they would want remembered across chats.",
    );
  } else {
    live.push(
      "- Memory tools are not connected (sign-in + cloud storage required). Relevant notes may already be in this prompt.",
    );
  }

  live.push(
    ctx.canPersistArtifacts
      ? "- create_artifact: save substantial reusable work to the Aether artifact panel (persists to their account)."
      : "- create_artifact: create substantial reusable work for the Aether artifact panel (they can save it).",
  );
  live.push(
    "- request_confirmation: gate destructive actions, spends, third-party submits, or deletes. Always wait for the user's confirm or Cancel card.",
  );

  if (ctx.hasDrive) {
    live.push(
      "- drive_search / drive_read: search and read the user's connected Google Drive (reads only).",
    );
  } else {
    live.push(
      "- Google Drive is not connected. Do not claim you can open their Drive files.",
    );
  }

  if (ctx.hasGitHub) {
    live.push(
      "- github_get_repo / github_list_contents / github_read_file: read repositories the signed-in user can access.",
    );
  } else {
    live.push(
      "- GitHub is not connected. For public repos you may use page fetch; do not invent private file contents.",
    );
  }

  const mode =
    ctx.approvalMode === "auto"
      ? "The user chose Auto: routine non-destructive Aether tools may run without a tap. Still always request confirmation for destructive actions, spends, third-party submits, deletes, or writes to someone else's Drive/GitHub."
      : "The user chose Ask (default): memory writes and similar mutations wait on a confirm card. create_artifact for a file, table, or document they asked for runs immediately. Safe reads may run immediately.";

  const lines = [
    "## Aether context (this turn)",
    "You are answering through Aether. A remote agent host owns web search, page fetch, code execution, and sandbox files. Use those when they improve accuracy.",
    "Aether-owned tools are live this turn and execute on Aether (the user's session stays on Aether — never ask them for connector tokens):",
    ...live,
    mode,
    "If an Aether tool is already in your native tool list, call it normally. If it is not, emit exactly one fenced call and wait for the result:",
    `${AETHER_TOOL_FENCE_OPEN}`,
    `{"name":"memory_search","arguments":{"query":"example"}}`,
    `${AETHER_TOOL_FENCE_CLOSE}`,
    "Do not invent other Aether tool names. Do not claim a confirmation already happened unless a confirm card was approved.",
  ];

  if (ctx.hasMemory) {
    lines.push(
      "- The user's curated memory (if any) is also injected below. Treat it as already retrieved; search again only when you need a different query.",
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
    "3. Put long deliverables in markdown or create_artifact so the user can save them from the Aether artifact panel.",
  ].join("\n");
}
