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
