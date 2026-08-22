/**
 * Sentence-case copy for Ask/Auto confirm cards.
 * Verb + consequence on the primary button; Cancel beside it.
 */

export type ConfirmActionCopy = {
  confirm: string;
  cancel: string;
  approvedNotice: string;
  cancelledNotice: string;
  failedNotice: string;
  expired: string;
  approvedStatus: string;
  cancelledStatus: string;
  destructive: boolean;
};

const CANCEL = "Cancel";

export function confirmActionCopy(input: {
  tool?: string;
  action?: string;
}): ConfirmActionCopy {
  const tool = (input.tool || "").toLowerCase();
  const action = (input.action || "").toLowerCase();
  const destructive =
    action.includes("delete") ||
    tool.includes("delete") ||
    action === "submit_form" ||
    action === "browser_click_submit" ||
    action === "browser_fill_and_submit" ||
    action === "send_message";

  let confirm = "Allow this";
  if (tool === "create_artifact") confirm = "Save artifact";
  else if (tool === "memory_write") confirm = "Save memory";
  else if (action.includes("delete") || tool.includes("delete")) {
    confirm = "Delete this";
  } else if (
    action === "submit_form" ||
    action === "browser_click_submit" ||
    action === "browser_fill_and_submit" ||
    action === "submit"
  ) {
    confirm = "Submit this";
  } else if (action === "send_message") confirm = "Send this";
  else if (action === "upload_file") confirm = "Upload this";

  return {
    confirm,
    cancel: CANCEL,
    approvedNotice: "You approved. Tell Aether to continue.",
    cancelledNotice: "You cancelled. Aether will not take that action.",
    failedNotice: "Couldn't record your choice. Try again.",
    expired: "This approval expired. Ask Aether to try again.",
    approvedStatus: "You approved. Tell Aether to continue.",
    cancelledStatus: "You cancelled this action.",
    destructive,
  };
}
