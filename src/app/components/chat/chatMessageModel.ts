import type { ApiMessage } from '../../../services/api';
import type { LocalChatMessage } from './ChatMessageBubble';

export function toLocalMessage(message: ApiMessage): LocalChatMessage {
  return {
    ...message,
    clientStatus: undefined,
  };
}

export function sortMessages<T extends { created_at: string; id?: string }>(messages: T[]) {
  return [...messages].sort((left, right) => {
    return (
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime() ||
      (right.id ?? '').localeCompare(left.id ?? '')
    );
  });
}

export function replaceOrAppendMessage(
  currentMessages: LocalChatMessage[],
  nextMessage: ApiMessage,
  optimisticId?: string,
) {
  const normalizedMessage = toLocalMessage(nextMessage);
  const existingIndex = currentMessages.findIndex((message) => message.id === normalizedMessage.id);

  if (existingIndex >= 0) {
    const nextMessages = [...currentMessages];
    nextMessages[existingIndex] = normalizedMessage;
    return sortMessages(nextMessages);
  }

  const optimisticIndex = currentMessages.findIndex((message) => {
    if (optimisticId && message.id === optimisticId) {
      return true;
    }

    return (
      message.clientStatus === 'sending' &&
      message.sender_id === normalizedMessage.sender_id &&
      message.receiver_id === normalizedMessage.receiver_id &&
      message.text === normalizedMessage.text
    );
  });

  if (optimisticIndex >= 0) {
    const nextMessages = [...currentMessages];
    nextMessages[optimisticIndex] = normalizedMessage;
    return sortMessages(nextMessages);
  }

  return sortMessages([...currentMessages, normalizedMessage]);
}

export function mergeServerMessages(
  serverMessages: ApiMessage[],
  currentMessages: LocalChatMessage[],
) {
  const merged = sortMessages(serverMessages.map(toLocalMessage));
  const leftoverMessages = currentMessages.filter((message) => {
    if (message.clientStatus !== 'sending' && message.clientStatus !== 'failed') {
      return false;
    }

    return !merged.some(
      (serverMessage) =>
        serverMessage.sender_id === message.sender_id &&
        serverMessage.receiver_id === message.receiver_id &&
        serverMessage.text === message.text &&
        Math.abs(new Date(serverMessage.created_at).getTime() - new Date(message.created_at).getTime()) < 15000,
    );
  });

  return sortMessages([...merged, ...leftoverMessages]);
}

export function mergeMessagesById(
  incomingMessages: ApiMessage[],
  currentMessages: LocalChatMessage[],
) {
  const messagesById = new Map<string, LocalChatMessage>();

  currentMessages.forEach((message) => messagesById.set(message.id, message));
  incomingMessages.forEach((message) => messagesById.set(message.id, toLocalMessage(message)));

  return sortMessages([...messagesById.values()]);
}

export function createOptimisticMessage({
  id,
  senderId,
  receiverId,
  text,
  createdAt,
  clientStatus = 'sending',
}: {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  createdAt?: string;
  clientStatus?: LocalChatMessage['clientStatus'];
}): LocalChatMessage {
  return {
    id,
    sender_id: senderId,
    receiver_id: receiverId,
    text,
    read: false,
    created_at: createdAt ?? new Date().toISOString(),
    clientStatus,
  };
}
