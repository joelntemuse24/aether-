import { and, desc, eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { agentRunEvents, agentRuns } from "@/lib/db/schema";
import type {
  HarnessClassification,
  HarnessDepth,
  HarnessIntent,
  HarnessRunStatus,
} from "./types";

export async function createAgentRun(input: {
  id: string;
  userId: string;
  conversationId?: string | null;
  classification: HarnessClassification;
  status: HarnessRunStatus;
}): Promise<boolean> {
  if (!isCloudDbConfigured()) return false;
  try {
    const db = await getDb();
    const now = new Date();
    await db.insert(agentRuns).values({
      id: input.id,
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      intent: input.classification.intent,
      depth: input.classification.depth,
      status: input.status,
      planJson: input.classification.planSteps
        ? { steps: input.classification.planSteps }
        : null,
      classificationJson: input.classification,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(agentRunEvents).values({
      id: crypto.randomUUID(),
      runId: input.id,
      type: "classified",
      payloadJson: input.classification,
      createdAt: now,
    });
    return true;
  } catch (err) {
    console.warn("[harness/runs] create failed", err);
    return false;
  }
}

export async function updateAgentRunStatus(input: {
  id: string;
  userId: string;
  status: HarnessRunStatus;
  eventType?: string;
  eventPayload?: Record<string, unknown>;
}): Promise<void> {
  if (!isCloudDbConfigured()) return;
  try {
    const db = await getDb();
    const now = new Date();
    await db
      .update(agentRuns)
      .set({ status: input.status, updatedAt: now })
      .where(and(eq(agentRuns.id, input.id), eq(agentRuns.userId, input.userId)));
    if (input.eventType) {
      await db.insert(agentRunEvents).values({
        id: crypto.randomUUID(),
        runId: input.id,
        type: input.eventType,
        payloadJson: input.eventPayload ?? null,
        createdAt: now,
      });
    }
  } catch (err) {
    console.warn("[harness/runs] update failed", err);
  }
}

export async function getRecentRunsForUser(
  userId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    intent: HarnessIntent;
    depth: HarnessDepth;
    status: string;
  }>
> {
  if (!isCloudDbConfigured()) return [];
  try {
    const db = await getDb();
    const rows = await db
      .select({
        id: agentRuns.id,
        intent: agentRuns.intent,
        depth: agentRuns.depth,
        status: agentRuns.status,
      })
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      intent: r.intent as HarnessIntent,
      depth: r.depth as HarnessDepth,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

/** Load a single run for Agent panel / resume (same harness, richer UI later). */
export async function getAgentRunForUser(
  userId: string,
  runId: string,
): Promise<{
  id: string;
  conversationId: string | null;
  intent: HarnessIntent;
  depth: HarnessDepth;
  status: string;
  plan: unknown;
  classification: unknown;
  events: Array<{ type: string; payload: unknown; createdAt: Date }>;
  updatedAt: Date;
} | null> {
  if (!isCloudDbConfigured()) return null;
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const events = await db
      .select({
        type: agentRunEvents.type,
        payloadJson: agentRunEvents.payloadJson,
        createdAt: agentRunEvents.createdAt,
      })
      .from(agentRunEvents)
      .where(eq(agentRunEvents.runId, runId))
      .orderBy(desc(agentRunEvents.createdAt))
      .limit(40);
    return {
      id: row.id,
      conversationId: row.conversationId,
      intent: row.intent as HarnessIntent,
      depth: row.depth as HarnessDepth,
      status: row.status,
      plan: row.planJson,
      classification: row.classificationJson,
      events: events.map((e) => ({
        type: e.type,
        payload: e.payloadJson,
        createdAt: e.createdAt,
      })),
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

/** Mark a run resumable (blocked_on_user or re-acting after continue). */
export async function markAgentRunResumable(input: {
  id: string;
  userId: string;
  status?: HarnessRunStatus;
  note?: string;
}): Promise<void> {
  await updateAgentRunStatus({
    id: input.id,
    userId: input.userId,
    status: input.status ?? "acting",
    eventType: "resume",
    eventPayload: { note: input.note ?? "Resumed harness run" },
  });
}
