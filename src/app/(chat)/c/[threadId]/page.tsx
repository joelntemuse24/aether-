type Props = {
  params: Promise<{ threadId: string }>;
};

/** Existing conversation at `/c/<threadId>`. Sync is handled by ThreadUrlSync. */
export default async function ConversationPage({ params }: Props) {
  await params;
  return null;
}
