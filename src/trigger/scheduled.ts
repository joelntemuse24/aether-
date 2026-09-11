/**
 * Recurring automations. Prepares a draft and a confirm card.
 * Never sends email or posts without that card.
 */

import { schedules } from "@trigger.dev/sdk";
import { createConfirmationRequest } from "@/lib/harness/confirmation";
import { runScheduledAutomation } from "@/lib/schedules/runner";
import { SCHEDULED_AUTOMATION_TASK_ID } from "@/lib/schedules/register";
import { getScheduleStore } from "@/lib/schedules/store";

export const scheduledAutomation = schedules.task({
  id: SCHEDULED_AUTOMATION_TASK_ID,
  run: async (payload) => {
    const userId = payload.externalId?.trim();
    if (!userId) {
      return { ok: false, sent: false, error: "No user on this schedule." };
    }
    const store = getScheduleStore();
    const jobs = await store.list(userId);
    const job =
      jobs.find((row) => row.triggerScheduleId === payload.scheduleId) ??
      jobs[0];
    if (!job) {
      return { ok: false, sent: false, error: "No matching automation." };
    }
    const result = await runScheduledAutomation(job);
    await createConfirmationRequest(
      {
        action: result.action,
        title: result.title,
        preview: result.preview,
        payload: {
          tool: job.delivery === "email" ? "gmail_send" : "request_confirmation",
          args: {
            subject: result.draft.subject,
            body: result.draft.body,
            title: job.title,
          },
          scheduledJobId: job.id,
        },
      },
      userId,
      { conversationId: job.conversationId ?? undefined },
    );
    await store.markRan(userId, job.id, new Date().toISOString());
    return { ...result, sent: false as const };
  },
});
