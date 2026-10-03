/**
 * Connector tokens are resolved when the tool runs. The sealed tool context
 * must not carry them: the VM can read that header, and the transport secret
 * must not also be the encryption key.
 */
export async function connectorTokensForToolCall(input: {
  userId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  readDrive: (userId: string) => Promise<{ accessToken: string } | null>;
  readGitHub: (userId: string) => Promise<{ accessToken: string } | null>;
}): Promise<{ driveAccessToken?: string; githubAccessToken?: string }> {
  const driveAccessToken =
    input.userId && input.hasDrive
      ? ((await input.readDrive(input.userId).catch(() => null))?.accessToken ?? undefined)
      : undefined;
  const githubAccessToken =
    input.userId && input.hasGitHub
      ? ((await input.readGitHub(input.userId).catch(() => null))?.accessToken ?? undefined)
      : undefined;
  return { driveAccessToken, githubAccessToken };
}
