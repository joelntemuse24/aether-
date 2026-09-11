import { scheduledRunMustConfirmBeforeSend } from "./policy";
import type { ScheduledJob } from "./types";

export type ScheduledRunResult = {
  ok: boolean;
  sent: false;
  needs_confirmation: true;
  action: "send_message" | "other_side_effect";
  title: string;
  preview: string;
  draft: { subject?: string; body: string };
  error?: string;
};

export async function runScheduledAutomation(
  job: ScheduledJob,
  _deps?: {
    sendEmail?: (draft: { subject: string; body: string }) => Promise<{ ok: boolean }>;
    triggerConfigured?: boolean;
  },
): Promise<ScheduledRunResult> {
  void _deps;
  const mustConfirm = scheduledRunMustConfirmBeforeSend({ delivery: job.delivery });
  const body = job.prompt.trim();
  const title =
    job.delivery === "email"
      ? `Send scheduled: ${job.title}`
      : `Post scheduled: ${job.title}`;
  const preview =
    job.delivery === "email"
      ? `Prepared “${job.title}” to send. Confirm before anything goes out.\n\n${body}`
      : `Prepared “${job.title}” for this chat. Confirm before it is posted.\n\n${body}`;

  if (!mustConfirm) {
    // Policy is hard-fail-closed; this branch is unreachable on purpose.
    return {
      ok: true,
      sent: false,
      needs_confirmation: true,
      action: "send_message",
      title,
      preview,
      draft: { subject: job.title, body },
    };
  }

  return {
    ok: true,
    sent: false,
    needs_confirmation: true,
    action: job.delivery === "email" ? "send_message" : "other_side_effect",
    title: title.slice(0, 120),
    preview: preview.slice(0, 2000),
    draft: { subject: job.title, body },
  };
}
