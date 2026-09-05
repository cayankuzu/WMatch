export const canViewProfileIdentityField = ({
  fieldEnabled,
  profileUserId,
  viewerUserId,
}: {
  fieldEnabled: boolean;
  profileUserId: string;
  viewerUserId?: string | null;
}) => fieldEnabled || Boolean(viewerUserId && viewerUserId === profileUserId);

export const redactPeerReadReceipts = <
  T extends { read?: boolean | null; sender_id?: string | null },
>(
  messages: T[],
  currentUserId: string,
  peerReadReceiptsEnabled: boolean,
): T[] => {
  if (peerReadReceiptsEnabled) {
    return messages;
  }

  return messages.map((message) =>
    message.sender_id === currentUserId && message.read
      ? { ...message, read: false }
      : message
  );
};

