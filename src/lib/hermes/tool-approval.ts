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
]);

const SAFE_READ_TOOLS = new Set<string>([
  TOOL_NAMES.memorySearch,
  TOOL_NAMES.driveSearch,
  TOOL_NAMES.driveRead,
  TOOL_NAMES.githubGetRepo,
  TOOL_NAMES.githubListContents,
  TOOL_NAMES.githubReadFile,
]);

const ROUTINE_MUTATION_TOOLS = new Set<string>([TOOL_NAMES.memoryWrite]);

/** Files / tables / docs the user just asked for — land, don't pause. */
const USER_DELIVERABLE_TOOLS = new Set<string>([TOOL_NAMES.createArtifact]);

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
  const action = actionOf(args);
  if (DESTRUCTIVE_ACTIONS.has(action)) return true;
  if (name === TOOL_NAMES.browserAct && action === "submit") return true;
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
