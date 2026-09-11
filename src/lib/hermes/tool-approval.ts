/**
 * Ask vs Auto approval policy for Aether-owned tools.
 *
 * Ask (default): mutations wait on a confirm card. Safe reads stay live.
 * create_artifact for a file/table/doc the user asked for lands immediately.
 * Auto: routine / non-destructive Aether tools run without a tap.
 * Always confirm: destructive, spend, third-party submit, delete,
 * or writes to someone else's Drive/GitHub.
 */

import { TOOL_NAMES } from "@/lib/tools";

export const TOOL_APPROVAL_MODES = ["ask", "auto"] as const;
export type ToolApprovalMode = (typeof TOOL_APPROVAL_MODES)[number];

export const DEFAULT_TOOL_APPROVAL_MODE: ToolApprovalMode = "ask";

const ALWAYS_CONFIRM_TOOLS = new Set<string>([
  TOOL_NAMES.requestConfirmation,
  TOOL_NAMES.generateImage,
  // Publishing / finalizing actions are always visible to others.
  TOOL_NAMES.githubCreateIssue,
  TOOL_NAMES.githubAddIssueComment,
  TOOL_NAMES.githubCreatePullRequest,
  TOOL_NAMES.githubMergePullRequest,
]);

const SAFE_READ_TOOLS = new Set<string>([
  TOOL_NAMES.memorySearch,
  TOOL_NAMES.projectKnowledgeSearch,
  TOOL_NAMES.driveSearch,
  TOOL_NAMES.driveRead,
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
  TOOL_NAMES.githubListIssues,
  TOOL_NAMES.githubGetIssue,
  TOOL_NAMES.githubListPullRequests,
  TOOL_NAMES.githubGetPullRequest,
  TOOL_NAMES.githubListCommits,
  TOOL_NAMES.workspaceReadFile,
  TOOL_NAMES.workspaceListFiles,
  TOOL_NAMES.gmailSearch,
  TOOL_NAMES.gmailRead,
  TOOL_NAMES.calendarListEvents,
  TOOL_NAMES.contactsSearch,
]);

/**
 * Routine mutations on the user's own resources. In Ask mode they wait on a
 * card; in Auto they run directly. Email send is deliberately here — the
 * user's Ask/Auto choice is the consent mechanism.
 */
const ROUTINE_MUTATION_TOOLS = new Set<string>([
  TOOL_NAMES.memoryWrite,
  TOOL_NAMES.gmailSend,
  TOOL_NAMES.gmailCreateDraft,
  TOOL_NAMES.calendarCreateEvent,
  TOOL_NAMES.contactsCreate,
]);

/**
 * Owned-repo GitHub writes classify ownership server-side in the dispatcher
 * (never from model args), so the policy layer treats them as routine
 * mutations for the connected user's own repos.
 */
const GITHUB_OWNED_WRITE_TOOLS = new Set<string>([
  TOOL_NAMES.githubCreateBranch,
  TOOL_NAMES.githubCreateOrUpdateFile,
]);

/** Files / tables / docs the user just asked for — land, don't pause. */
const USER_DELIVERABLE_TOOLS = new Set<string>([
  TOOL_NAMES.createArtifact,
  TOOL_NAMES.createPresentation,
  TOOL_NAMES.createSpreadsheet,
  TOOL_NAMES.createDocument,
  TOOL_NAMES.createPdf,
  TOOL_NAMES.workspaceExec,
  TOOL_NAMES.workspaceWriteFile,
  TOOL_NAMES.workspacePublishFile,
]);

const DESTRUCTIVE_ACTIONS = new Set<string>([
  "submit_form",
  "send_message",
  "upload_file",
  "browser_click_submit",
  "browser_fill_and_submit",
  "delete_resource",
  "other_side_effect",
]);

export function parseToolApprovalMode(raw: unknown): ToolApprovalMode {
  if (raw === "auto") return "auto";
  return "ask";
}

export function isSafeReadAetherTool(name: string): boolean {
  return SAFE_READ_TOOLS.has(name);
}

export function isRoutineMutationAetherTool(name: string): boolean {
  return ROUTINE_MUTATION_TOOLS.has(name);
}

export function isUserDeliverableAetherTool(name: string): boolean {
  return USER_DELIVERABLE_TOOLS.has(name);
}

function actionOf(args: Record<string, unknown> | undefined): string {
  const action = args?.action;
  return typeof action === "string" ? action : "";
}

/**
 * True when this call must show a confirm card even in Auto.
 * Covers explicit confirmation, deletes, spends, third-party submits,
 * and writes aimed at someone else's Drive/GitHub.
 */
export function isAlwaysConfirmAetherCall(
  name: string,
  args?: Record<string, unknown>,
): boolean {
  if (ALWAYS_CONFIRM_TOOLS.has(name)) return true;
  // Artifact creation is a routine deliverable. A generic side-effect label
  // from a model payload must not turn it into an approval card.
  if (name === TOOL_NAMES.createArtifact) {
    return (
      args?.foreignOwner === true ||
      args?.someoneElses === true ||
      args?.targetOwner === "other" ||
      args?.scope === "foreign"
    );
  }
  const action = actionOf(args);
  if (DESTRUCTIVE_ACTIONS.has(action)) return true;
  if (name === TOOL_NAMES.browserAct && action === "submit") return true;
  if (GITHUB_OWNED_WRITE_TOOLS.has(name)) {
    // Foreign-owner args only force the card earlier; the dispatcher
    // re-verifies ownership from real repo metadata either way.
    return false;
  }
  if (name.includes("delete") || action.includes("delete")) return true;
  if (args?.foreignOwner === true || args?.someoneElses === true) return true;
  if (args?.targetOwner === "other" || args?.scope === "foreign") return true;
  return false;
}

export type ApprovalDecision =
  | {
      confirm: false;
      reason: "safe_read" | "auto_routine" | "skip_gate" | "user_deliverable";
    }
  | { confirm: true; reason: "always" | "ask_mutation" };

/**
 * Decide whether an Aether-owned tool call waits on a confirm card.
 */
export function approvalDecisionForAetherTool(input: {
  name: string;
  args?: Record<string, unknown>;
  mode: ToolApprovalMode;
  /** When true, a prior user approval already covers this call. */
  skipGate?: boolean;
}): ApprovalDecision {
  if (input.skipGate) {
    return { confirm: false, reason: "skip_gate" };
  }
  if (isAlwaysConfirmAetherCall(input.name, input.args)) {
    return { confirm: true, reason: "always" };
  }
  if (isSafeReadAetherTool(input.name)) {
    return { confirm: false, reason: "safe_read" };
  }
  if (isUserDeliverableAetherTool(input.name)) {
    return { confirm: false, reason: "user_deliverable" };
  }
  if (GITHUB_OWNED_WRITE_TOOLS.has(input.name)) {
    if (input.mode === "auto") {
      return { confirm: false, reason: "auto_routine" };
    }
    return { confirm: true, reason: "ask_mutation" };
  }
  if (isRoutineMutationAetherTool(input.name)) {
    if (input.mode === "auto") {
      return { confirm: false, reason: "auto_routine" };
    }
    return { confirm: true, reason: "ask_mutation" };
  }
  // Unknown Aether side-effect: fail closed to a card.
  return { confirm: true, reason: "always" };
}

export function shouldConfirmAetherTool(input: {
  name: string;
  args?: Record<string, unknown>;
  mode: ToolApprovalMode;
  skipGate?: boolean;
}): boolean {
  return approvalDecisionForAetherTool(input).confirm;
}
