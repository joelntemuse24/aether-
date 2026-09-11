export const SCHEDULE_DELIVERIES = ["email", "inbox"] as const;
export type ScheduleDelivery = (typeof SCHEDULE_DELIVERIES)[number];

export const SCHEDULE_STATUSES = ["active", "paused", "cancelled"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export type ScheduledJob = {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  cron: string;
  timezone: string;
  delivery: ScheduleDelivery;
  status: ScheduleStatus;
  conversationId?: string | null;
  triggerScheduleId?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateScheduledJobInput = {
  userId: string;
  title: string;
  prompt: string;
  cron: string;
  timezone?: string;
  delivery: ScheduleDelivery;
  conversationId?: string | null;
  triggerScheduleId?: string | null;
};
