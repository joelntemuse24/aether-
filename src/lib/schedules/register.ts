import { isTriggerChatConfigured } from "@/lib/trigger/config";
import { parseScheduleWhen } from "./cron";
import { getScheduleStore } from "./store";
import { createTriggerSchedule as defaultCreateTriggerSchedule } from "./trigger-register";
import type { CreateScheduledJobInput, ScheduledJob } from "./types";

export const SCHEDULED_AUTOMATION_TASK_ID = "scheduled.automation";

export type RegisterScheduleInput = Omit<CreateScheduledJobInput, "cron"> & {
  when: string;
  cron?: string;
};

export async function registerScheduledJob(
  input: RegisterScheduleInput,
  deps?: {
    store?: ReturnType<typeof getScheduleStore>;
    triggerConfigured?: boolean;
    createTriggerSchedule?: (job: {
      cron: string;
      timezone: string;
      externalId: string;
    }) => Promise<{ id: string } | null>;
  },
): Promise<
  | { ok: true; job: ScheduledJob; fires: boolean; note?: string }
  | { ok: false; error: string }
> {
  const parsed = input.cron
    ? { ok: true as const, cron: input.cron, label: input.cron }
    : parseScheduleWhen(input.when);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const store = deps?.store ?? getScheduleStore();
  let triggerScheduleId: string | null = null;
  const triggerOn =
    deps?.triggerConfigured ?? isTriggerChatConfigured();
  const createTrigger =
    deps?.createTriggerSchedule ??
    (triggerOn ? defaultCreateTriggerSchedule : undefined);
  if (createTrigger) {
    try {
      const created = await createTrigger({
        cron: parsed.cron,
        timezone: input.timezone || "UTC",
        externalId: input.userId,
      });
      triggerScheduleId = created?.id ?? null;
    } catch {
      triggerScheduleId = null;
    }
  }

  const job = await store.create({
    userId: input.userId,
    title: input.title,
    prompt: input.prompt,
    cron: parsed.cron,
    timezone: input.timezone || "UTC",
    delivery: input.delivery,
    conversationId: input.conversationId,
    triggerScheduleId,
  });

  const fires = triggerOn && !!triggerScheduleId;
  return {
    ok: true,
    job,
    fires,
    note: fires
      ? undefined
      : "Saved. It will not fire until an operator enables scheduled jobs.",
  };
}
