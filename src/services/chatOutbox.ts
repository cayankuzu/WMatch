import * as SecureStore from 'expo-secure-store';

import { sendMessage, type ApiMessage } from './api';
import { telemetry } from './telemetry';
import { MAX_MESSAGE_LENGTH } from '../shared/constants';
import { countMessageCharacters } from '../shared/utils/validation';

export interface PendingChatMessage {
  clientMessageId: string;
  peerUserId: string;
  text: string;
  createdAt: string;
}

const OUTBOX_VERSION = 1;
const OUTBOX_MAX_MESSAGES = 40;
const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const mutationFlights = new Map<string, Promise<unknown>>();
const flushFlights = new Map<string, Promise<number>>();
const SAFE_KEY_PART_PATTERN = /^[\w.-]{8,120}$/;

function validatePendingMessage(message: PendingChatMessage) {
  const normalizedText = message.text.trim();

  if (!SAFE_KEY_PART_PATTERN.test(message.clientMessageId)) {
    throw new Error('Invalid chat outbox message identifier.');
  }

  if (!SAFE_KEY_PART_PATTERN.test(message.peerUserId)) {
    throw new Error('Invalid chat outbox peer identifier.');
  }

  if (!normalizedText || countMessageCharacters(normalizedText) > MAX_MESSAGE_LENGTH) {
    throw new Error('Invalid chat outbox message body.');
  }

  if (!Number.isFinite(new Date(message.createdAt).getTime())) {
    throw new Error('Invalid chat outbox timestamp.');
  }

  return { ...message, text: normalizedText };
}

function indexKey(userId: string) {
  return `wmatch.chat-outbox-index.v${OUTBOX_VERSION}.${userId}`;
}

function messageKey(userId: string, clientMessageId: string) {
  return `wmatch.chat-outbox.v${OUTBOX_VERSION}.${userId}.${clientMessageId}`;
}

async function readIndex(userId: string) {
  const rawValue = await SecureStore.getItemAsync(indexKey(userId));

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(-OUTBOX_MAX_MESSAGES)
      : [];
  } catch {
    await SecureStore.deleteItemAsync(indexKey(userId));
    return [];
  }
}

function withMutationLock<T>(userId: string, operation: () => Promise<T>) {
  const previous = mutationFlights.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  mutationFlights.set(userId, next);
  const cleanup = () => {
    if (mutationFlights.get(userId) === next) {
      mutationFlights.delete(userId);
    }
  };
  void next.then(cleanup, cleanup);
  return next;
}

async function readPendingMessagesUnlocked(userId: string) {
  const ids = await readIndex(userId);
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        const rawValue = await SecureStore.getItemAsync(messageKey(userId, id));
        if (!rawValue) {
          return null;
        }

        const item = JSON.parse(rawValue) as Partial<PendingChatMessage>;
        if (
          item.clientMessageId !== id ||
          typeof item.peerUserId !== 'string' ||
          typeof item.text !== 'string' ||
          typeof item.createdAt !== 'string' ||
          !Number.isFinite(new Date(item.createdAt).getTime())
        ) {
          return null;
        }

        return item as PendingChatMessage;
      } catch {
        return null;
      }
    }),
  );
  const cutoff = Date.now() - OUTBOX_MAX_AGE_MS;
  const validEntries = entries.filter(
    (item): item is PendingChatMessage => item != null && new Date(item.createdAt).getTime() >= cutoff,
  );
  const validIds = new Set(validEntries.map((item) => item.clientMessageId));

  await Promise.all(
    ids
      .filter((id) => !validIds.has(id))
      .map((id) => SecureStore.deleteItemAsync(messageKey(userId, id))),
  );
  await SecureStore.setItemAsync(indexKey(userId), JSON.stringify(validEntries.map((item) => item.clientMessageId)));

  return validEntries.sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export function listPendingChatMessages(userId: string, peerUserId?: string) {
  return withMutationLock(userId, async () => {
    const entries = await readPendingMessagesUnlocked(userId);
    return peerUserId ? entries.filter((item) => item.peerUserId === peerUserId) : entries;
  });
}

export function enqueuePendingChatMessage(userId: string, message: PendingChatMessage) {
  return withMutationLock(userId, async () => {
    const validatedMessage = validatePendingMessage(message);
    const entries = await readPendingMessagesUnlocked(userId);
    const nextEntries = [
      ...entries.filter((item) => item.clientMessageId !== validatedMessage.clientMessageId),
      validatedMessage,
    ].slice(-OUTBOX_MAX_MESSAGES);
    const retainedIds = new Set(nextEntries.map((item) => item.clientMessageId));

    await SecureStore.setItemAsync(
      messageKey(userId, validatedMessage.clientMessageId),
      JSON.stringify(validatedMessage),
    );
    await Promise.all(
      entries
        .filter((item) => !retainedIds.has(item.clientMessageId))
        .map((item) => SecureStore.deleteItemAsync(messageKey(userId, item.clientMessageId))),
    );
    await SecureStore.setItemAsync(indexKey(userId), JSON.stringify([...retainedIds]));
  });
}

export function removePendingChatMessage(userId: string, clientMessageId: string) {
  return withMutationLock(userId, async () => {
    const ids = await readIndex(userId);
    await SecureStore.setItemAsync(
      indexKey(userId),
      JSON.stringify(ids.filter((id) => id !== clientMessageId)),
    );
    await SecureStore.deleteItemAsync(messageKey(userId, clientMessageId));
  });
}

export function flushPendingChatMessages(
  userId: string,
  onSent?: (pending: PendingChatMessage, message: ApiMessage) => void,
) {
  const existing = flushFlights.get(userId);
  if (existing) {
    return existing;
  }

  const next = (async () => {
    const entries = await listPendingChatMessages(userId);
    let sentCount = 0;

    for (const pending of entries) {
      try {
        const message = await sendMessage(pending.peerUserId, pending.text, pending.clientMessageId);
        await removePendingChatMessage(userId, pending.clientMessageId);
        onSent?.(pending, message);
        sentCount += 1;
      } catch {
        break;
      }
    }

    return sentCount;
  })()
    .catch((error) => {
      telemetry.captureException(error, { scope: 'chat.outbox_flush' });
      return 0;
    })
    .finally(() => {
      flushFlights.delete(userId);
    });

  flushFlights.set(userId, next);
  return next;
}

export function purgeChatOutbox(userId: string | null | undefined) {
  if (!userId) {
    return Promise.resolve();
  }

  return withMutationLock(userId, async () => {
    const ids = await readIndex(userId);
    await Promise.all(ids.map((id) => SecureStore.deleteItemAsync(messageKey(userId, id))));
    await SecureStore.deleteItemAsync(indexKey(userId));
  });
}
