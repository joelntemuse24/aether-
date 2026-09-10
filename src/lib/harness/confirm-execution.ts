import { auth } from "@/auth";
import { isCloudDbConfigured } from "@/lib/db";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import { getValidGitHubAccessToken } from "@/lib/github-session";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import type { AetherToolContext } from "@/lib/hermes/aether-tools";

/**
 * Build an execution context for an approved confirmation replay from the
 * signed-in user's CURRENT connector grants. The replay payload itself never
 * carries tokens; capabilities and tokens are reacquired server-side so
 * approved Drive/GitHub work can actually execute.
 *
 * Callers must keep skipGate: true — the user already approved this call.
 */
export async function connectorContextForReplay(input: {
  userId: string | null;
  conversationId?: string | null;
  projectId: string | null;
  runId?: string | null;
}): Promise<AetherToolContext> {
  const session = await auth();
  const userId =
    input.userId ?? session?.user?.id ?? session?.user?.email ?? null;
  const hasDrive = userId ? !!(await getValidDriveAccessToken(userId)) : false;
  const hasGitHub = userId ? !!(await getValidGitHubAccessToken(userId)) : false;

  return {
    userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    runId: input.runId ?? null,
    approvalMode: parseToolApprovalMode("ask"),
    hasMemory: !!(userId && isCloudDbConfigured()),
    hasDrive,
    hasGitHub,
    skipGate: true,
  };
}
