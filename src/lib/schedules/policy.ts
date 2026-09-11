import type { ScheduleDelivery } from "./types";

/**
 * Scheduled automations may prepare a draft. They never send until the user
 * confirms that specific run — including Auto, and even if creating the
 * schedule was already approved.
 */
export function scheduledRunMustConfirmBeforeSend(input: {
  delivery: ScheduleDelivery;
}): boolean {
  void input.delivery;
  return true;
}

export function scheduledSendIsBlocked(input: {
  delivery: ScheduleDelivery;
  sendConfirmed?: boolean;
  scheduleAlreadyApproved?: boolean;
  mode?: "ask" | "auto";
}): boolean {
  void input.delivery;
  void input.scheduleAlreadyApproved;
  void input.mode;
  return input.sendConfirmed !== true;
}
