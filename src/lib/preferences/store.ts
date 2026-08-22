import { eq } from "drizzle-orm";
import { getDb, isCloudDbConfigured } from "@/lib/db";
import { userPreferences } from "@/lib/db/schema";
import {
  DEFAULT_TOOL_APPROVAL_MODE,
  parseToolApprovalMode,
  type ToolApprovalMode,
} from "@/lib/hermes/tool-approval";

export type UserPreferenceRecord = {
  userId: string;
  toolApprovalMode: ToolApprovalMode;
};

export async function getUserPreferences(
  userId: string,
): Promise<UserPreferenceRecord> {
  if (!isCloudDbConfigured()) {
    return { userId, toolApprovalMode: DEFAULT_TOOL_APPROVAL_MODE };
  }
  const db = await getDb();
  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return {
    userId,
    toolApprovalMode: parseToolApprovalMode(rows[0]?.toolApprovalMode),
  };
}

export async function saveUserPreferences(
  userId: string,
  patch: { toolApprovalMode?: ToolApprovalMode },
): Promise<UserPreferenceRecord> {
  const current = await getUserPreferences(userId);
  const next: UserPreferenceRecord = {
    userId,
    toolApprovalMode: patch.toolApprovalMode ?? current.toolApprovalMode,
  };
  if (!isCloudDbConfigured()) return next;
  const db = await getDb();
  const now = new Date();
  await db
    .insert(userPreferences)
    .values({
      userId,
      toolApprovalMode: next.toolApprovalMode,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        toolApprovalMode: next.toolApprovalMode,
        updatedAt: now,
      },
    });
  return next;
}
