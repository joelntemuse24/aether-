import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { isCloudDbConfigured, getDb } from "@/lib/db";
import { scheduledJobs } from "@/lib/db/schema";
import type { CreateScheduledJobInput, ScheduledJob, ScheduleStatus } from "./types";

export type ScheduleStore = {
  create: (input: CreateScheduledJobInput) => Promise<ScheduledJob>;
  list: (userId: string) => Promise<ScheduledJob[]>;
  get: (userId: string, id: string) => Promise<ScheduledJob | null>;
  cancel: (userId: string, id: string) => Promise<ScheduledJob | null>;
  markRan: (userId: string, id: string, at: string) => Promise<void>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCreate(input: CreateScheduledJobInput): ScheduledJob {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("prompt is required.");
  const title = input.title.trim() || "Scheduled job";
  const at = nowIso();
  return {
    id: randomUUID(),
    userId: input.userId,
    title,
    prompt,
    cron: input.cron.trim(),
    timezone: (input.timezone || "UTC").trim() || "UTC",
    delivery: input.delivery,
    status: "active",
    conversationId: input.conversationId ?? null,
    triggerScheduleId: input.triggerScheduleId ?? null,
    lastRunAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

export function createMemoryScheduleStore(
  seed: ScheduledJob[] = [],
): ScheduleStore {
  const rows = new Map<string, ScheduledJob>(seed.map((row) => [row.id, { ...row }]));
  return {
    async create(input) {
      const row = normalizeCreate(input);
      rows.set(row.id, row);
      return { ...row };
    },
    async list(userId) {
      return [...rows.values()]
        .filter((row) => row.userId === userId && row.status !== "cancelled")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(userId, id) {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return null;
      return { ...row };
    },
    async cancel(userId, id) {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return null;
      const next = { ...row, status: "cancelled" as ScheduleStatus, updatedAt: nowIso() };
      rows.set(id, next);
      return { ...next };
    },
    async markRan(userId, id, at) {
      const row = rows.get(id);
      if (!row || row.userId !== userId) return;
      rows.set(id, { ...row, lastRunAt: at, updatedAt: at });
    },
  };
}

function fromRow(row: typeof scheduledJobs.$inferSelect): ScheduledJob {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    prompt: row.prompt,
    cron: row.cron,
    timezone: row.timezone,
    delivery: row.delivery === "email" ? "email" : "inbox",
    status:
      row.status === "paused" || row.status === "cancelled" ? row.status : "active",
    conversationId: row.conversationId,
    triggerScheduleId: row.triggerScheduleId,
    lastRunAt: row.lastRunAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createDbScheduleStore(): ScheduleStore {
  return {
    async create(input) {
      const row = normalizeCreate(input);
      const db = await getDb();
      await db.insert(scheduledJobs).values({
        id: row.id,
        userId: row.userId,
        title: row.title,
        prompt: row.prompt,
        cron: row.cron,
        timezone: row.timezone,
        delivery: row.delivery,
        status: row.status,
        conversationId: row.conversationId ?? null,
        triggerScheduleId: row.triggerScheduleId ?? null,
        lastRunAt: null,
      });
      return row;
    },
    async list(userId) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(scheduledJobs)
        .where(and(eq(scheduledJobs.userId, userId)))
        .orderBy(desc(scheduledJobs.createdAt));
      return rows.map(fromRow).filter((row) => row.status !== "cancelled");
    },
    async get(userId, id) {
      const db = await getDb();
      const rows = await db
        .select()
        .from(scheduledJobs)
        .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.userId, userId)))
        .limit(1);
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async cancel(userId, id) {
      const existing = await this.get(userId, id);
      if (!existing) return null;
      const db = await getDb();
      const at = new Date();
      await db
        .update(scheduledJobs)
        .set({ status: "cancelled", updatedAt: at })
        .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.userId, userId)));
      return { ...existing, status: "cancelled", updatedAt: at.toISOString() };
    },
    async markRan(userId, id, at) {
      const db = await getDb();
      await db
        .update(scheduledJobs)
        .set({ lastRunAt: at, updatedAt: new Date(at) })
        .where(and(eq(scheduledJobs.id, id), eq(scheduledJobs.userId, userId)));
    },
  };
}

let memoryFallback: ScheduleStore | null = null;

export function getScheduleStore(): ScheduleStore {
  if (isCloudDbConfigured()) return createDbScheduleStore();
  if (!memoryFallback) memoryFallback = createMemoryScheduleStore();
  return memoryFallback;
}
