import { isTriggerChatConfigured } from "@/lib/trigger/config";
import { SCHEDULED_AUTOMATION_TASK_ID } from "./register";

export async function createTriggerSchedule(input: {
  cron: string;
  timezone: string;
  externalId: string;
}): Promise<{ id: string } | null> {
  if (!isTriggerChatConfigured()) return null;
  try {
    const { schedules } = await import("@trigger.dev/sdk");
    const created = await schedules.create({
      task: SCHEDULED_AUTOMATION_TASK_ID,
      cron: input.cron,
      timezone: input.timezone || "UTC",
      externalId: input.externalId,
      // SDK requires this; unique so a user can keep more than one job.
      deduplicationKey: `aether-schedule:${input.externalId}:${crypto.randomUUID()}`,
    });
    const id = (created as { id?: string }).id;
    return id ? { id } : null;
  } catch {
    return null;
  }
}

export async function deleteTriggerSchedule(id: string | null | undefined) {
  if (!id || !isTriggerChatConfigured()) return;
  try {
    const { schedules } = await import("@trigger.dev/sdk");
    await schedules.del(id);
  } catch {
    /* already gone */
  }
}
