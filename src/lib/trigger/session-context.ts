/**
 * Mint the opaque agent context JWT and merge it into clientData.
 * Used by start-session and the first-turn warm path.
 */

import { auth } from "@/auth";
import { isCloudDbConfigured } from "@/lib/db";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import { getValidGitHubAccessToken } from "@/lib/github-session";
import { readDriveCookie } from "@/lib/drive-session";
import { readGitHubCookie } from "@/lib/github-session";
import { getAuthSecretString } from "@/lib/auth-secret";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import type { ChatClientData } from "./client-data";
import { mergeStartSessionClientData } from "./start-session";
import { signAgentContextToken } from "./context-token";

export async function attachAgentContextToClientData(input: {
  chatId: string;
  clientData: ChatClientData;
}): Promise<ChatClientData> {
  const session = await auth();
  const userId = session?.user?.id || session?.user?.email || null;
  const hasDrive = userId ? !!(await getValidDriveAccessToken(userId)) : false;
  const hasGitHub = userId ? !!(await getValidGitHubAccessToken(userId)) : false;
  const drive = userId ? await readDriveCookie() : null;
  const github = userId ? await readGitHubCookie() : null;
  const conversationId = input.clientData.conversationId || input.chatId;
  const contextToken = await signAgentContextToken(
    {
      userId,
      conversationId,
      projectId: input.clientData.projectId ?? null,
      approvalMode: parseToolApprovalMode(input.clientData.approvalMode),
      hasMemory: !!(userId && isCloudDbConfigured()),
      hasDrive,
      hasGitHub,
      driveAccessToken:
        drive && drive.userId === userId ? drive.accessToken : undefined,
      driveRefreshToken:
        drive && drive.userId === userId ? drive.refreshToken : undefined,
      driveExpiresAt:
        drive && drive.userId === userId ? drive.expiresAt : undefined,
      githubAccessToken:
        github && github.userId === userId ? github.accessToken : undefined,
    },
    getAuthSecretString(),
  );

  return mergeStartSessionClientData({
    clientData: input.clientData,
    userId,
    conversationId,
    contextToken,
    hasDrive,
    hasGitHub,
    hasMemory: !!(userId && isCloudDbConfigured()),
  });
}
