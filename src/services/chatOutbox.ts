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
  retryCount?: number;
  nextAttemptAt?: string | null;
  status?: 'pending' | 'dead-letter' | 'cancelled';
  statusUpdatedAt?: string | null;
  relationshipEpoch?: number;
}

interface StoredPendingChatMessage extends PendingChatMessage {
  retryCount: number;
  nextAttemptAt: string | null;
  status: 'pending' | 'dead-letter' | 'cancelled';
  statusUpdatedAt: string | null;
  relationshipEpoch: number;
}

const OUTBOX_VERSION = 1;
const OUTBOX_MAX_MESSAGES = 40;
const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_MAX_RETRY_AGE_MS = 24 * 60 * 60 * 1000;
const OUTBOX_MAX_ATTEMPTS = 6;
const OUTBOX_RETRY_BASE_MS = 1_000;
const OUTBOX_RETRY_MAX_MS = 15 * 60 * 1000;
const mutationFlights = new Map<string, Promise<unknown>>();
const flushFlights = new Map<string, Promise<number>>();
const activeDeliveryControllers = new Map<string, AbortController>();
const SAFE_KEY_PART_PATTERN = /^[\w.-]{8,120}$/;

function peerKey(userId: string, peerUserId: string) {
  return `${userId}:${peerUserId}`;
}

function peerEpochKey(userId: string, peerUserId: string) {
  return `wmatch.chat-outbox-peer-epoch.v${OUTBOX_VERSION}.${userId}.${peerUserId}`;
}

function peerEpochIndexKey(userId: string) {
  return `wmatch.chat-outbox-peer-epoch-index.v${OUTBOX_VERSION}.${userId}`;
}

async function readPeerEpoch(userId: string, peerUserId: string) {
  const rawValue = await SecureStore.getItemAsync(peerEpochKey(userId, peerUserId));
  const parsedValue = rawValue == null ? 0 : Number(rawValue);
  return Number.isSafeInteger(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
}

async function readPeerEpochIndex(userId: string) {
  const rawValue = await SecureStore.getItemAsync(peerEpochIndexKey(userId));
  if (!rawValue) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    return Array.isArray(parsedValue)
      ? [...new Set(parsedValue.filter((value): value is string => (
          typeof value === 'string' && SAFE_KEY_PART_PATTERN.test(value)
        )))]
      : [];
  } catch {
    return [];
  }
}

function validatePendingMessage(message: PendingChatMessage): StoredPendingChatMessage {
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

  const status: StoredPendingChatMessage['status'] = message.status === 'dead-letter' || message.status === 'cancelled'
    ? message.status
    : 'pending';
  const retryCount = Number.isInteger(message.retryCount) && Number(message.retryCount) >= 0
    ? Math.min(Number(message.retryCount), OUTBOX_MAX_ATTEMPTS)
    : 0;
  const nextAttemptAt = typeof message.nextAttemptAt === 'string'
    && Number.isFinite(new Date(message.nextAttemptAt).getTime())
    ? message.nextAttemptAt
    : null;
  const statusUpdatedAt = typeof message.statusUpdatedAt === 'string'
    && Number.isFinite(new Date(message.statusUpdatedAt).getTime())
    ? message.statusUpdatedAt
    : null;
  const relationshipEpoch = Number.isSafeInteger(message.relationshipEpoch)
    && Number(message.relationshipEpoch) >= 0
    ? Number(message.relationshipEpoch)
    : 0;

  return {
    ...message,
    text: normalizedText,
    retryCount,
    nextAttemptAt,
    status,
    statusUpdatedAt,
    relationshipEpoch,
  };
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

        return validatePendingMessage(item as PendingChatMessage);
      } catch {
        return null;
      }
    }),
  );
  const cutoff = Date.now() - OUTBOX_MAX_AGE_MS;
  const validEntries = entries.filter(
    (item): item is StoredPendingChatMessage => item != null && new Date(item.createdAt).getTime() >= cutoff,
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
    const visibleEntries = entries.filter((item) => item.status !== 'cancelled');
    return peerUserId ? visibleEntries.filter((item) => item.peerUserId === peerUserId) : visibleEntries;
  });
}

export function enqueuePendingChatMessage(userId: string, message: PendingChatMessage) {
  return withMutationLock(userId, async () => {
    const relationshipEpoch = await readPeerEpoch(userId, message.peerUserId);
    const validatedMessage = validatePendingMessage({
      ...message,
      retryCount: 0,
      nextAttemptAt: null,
      status: 'pending',
      statusUpdatedAt: new Date().toISOString(),
      relationshipEpoch,
    });
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

export function cancelPendingChatMessage(userId: string, clientMessageId: string) {
  return withMutationLock(userId, async () => {
    const entries = await readPendingMessagesUnlocked(userId);
    const pending = entries.find((item) => item.clientMessageId === clientMessageId);
    if (!pending) {
      return;
    }

    await SecureStore.setItemAsync(
      messageKey(userId, clientMessageId),
      JSON.stringify({
        ...pending,
        nextAttemptAt: null,
        status: 'cancelled',
        statusUpdatedAt: new Date().toISOString(),
      }),
    );
  });
}

function markPendingChatMessageFailure(userId: string, clientMessageId: string) {
  return withMutationLock(userId, async () => {
    const entries = await readPendingMessagesUnlocked(userId);
    const pending = entries.find((item) => item.clientMessageId === clientMessageId);
    if (!pending || pending.status !== 'pending') {
      return;
    }

    const now = Date.now();
    const retryCount = (pending.retryCount ?? 0) + 1;
    const retryAgeMs = now - new Date(pending.createdAt).getTime();
    const deadLettered = retryCount >= OUTBOX_MAX_ATTEMPTS || retryAgeMs >= OUTBOX_MAX_RETRY_AGE_MS;
    const retryDelayMs = Math.min(
      OUTBOX_RETRY_BASE_MS * (2 ** Math.max(0, retryCount - 1)),
      OUTBOX_RETRY_MAX_MS,
    );

    await SecureStore.setItemAsync(
      messageKey(userId, clientMessageId),
      JSON.stringify({
        ...pending,
        retryCount,
        nextAttemptAt: deadLettered ? null : new Date(now + retryDelayMs).toISOString(),
        status: deadLettered ? 'dead-letter' : 'pending',
        statusUpdatedAt: new Date(now).toISOString(),
      }),
    );
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
      if (pending.status === 'dead-letter' || pending.status === 'cancelled') {
        continue;
      }

      if (pending.nextAttemptAt && new Date(pending.nextAttemptAt).getTime() > Date.now()) {
        break;
      }

      const relationshipEpoch = await readPeerEpoch(userId, pending.peerUserId);
      if (relationshipEpoch !== pending.relationshipEpoch) {
        await removePendingChatMessage(userId, pending.clientMessageId);
        continue;
      }

      try {
        const controller = new AbortController();
        const deliveryKey = peerKey(userId, pending.peerUserId);
        activeDeliveryControllers.set(deliveryKey, controller);
        const message = await sendMessage(
          pending.peerUserId,
          pending.text,
          pending.clientMessageId,
          controller.signal,
        );
        await removePendingChatMessage(userId, pending.clientMessageId);
        onSent?.(pending, message);
        sentCount += 1;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          await removePendingChatMessage(userId, pending.clientMessageId);
          continue;
        }
        await markPendingChatMessageFailure(userId, pending.clientMessageId);
        telemetry.captureException(error, { scope: 'chat.outbox_delivery' });
        break;
      } finally {
        activeDeliveryControllers.delete(peerKey(userId, pending.peerUserId));
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

export function purgeChatOutboxForPeer(userId: string, peerUserId: string) {
  if (!SAFE_KEY_PART_PATTERN.test(userId) || !SAFE_KEY_PART_PATTERN.test(peerUserId)) {
    return Promise.reject(new Error('Invalid chat outbox relationship identifier.'));
  }

  activeDeliveryControllers.get(peerKey(userId, peerUserId))?.abort();

  return withMutationLock(userId, async () => {
    const currentEpoch = await readPeerEpoch(userId, peerUserId);
    const nextEpoch = currentEpoch >= Number.MAX_SAFE_INTEGER ? 1 : currentEpoch + 1;

    // Persist the tombstone before deleting entries. A crash can leave stale rows,
    // but their prior epoch can never be replayed after a block/end/delete action.
    await SecureStore.setItemAsync(peerEpochKey(userId, peerUserId), String(nextEpoch));
    const epochPeers = await readPeerEpochIndex(userId);
    await SecureStore.setItemAsync(
      peerEpochIndexKey(userId),
      JSON.stringify([...new Set([...epochPeers, peerUserId])]),
    );

    const entries = await readPendingMessagesUnlocked(userId);
    const removedIds = entries
      .filter((entry) => entry.peerUserId === peerUserId)
      .map((entry) => entry.clientMessageId);
    const removedIdSet = new Set(removedIds);
    const retainedIds = entries
      .filter((entry) => !removedIdSet.has(entry.clientMessageId))
      .map((entry) => entry.clientMessageId);

    await SecureStore.setItemAsync(indexKey(userId), JSON.stringify(retainedIds));
    await Promise.all(
      removedIds.map((id) => SecureStore.deleteItemAsync(messageKey(userId, id))),
    );
  });
}

export function purgeChatOutbox(userId: string | null | undefined) {
  if (!userId) {
    return Promise.resolve();
  }

  return withMutationLock(userId, async () => {
    const ids = await readIndex(userId);
    const epochPeers = await readPeerEpochIndex(userId);
    epochPeers.forEach((peerUserId) => {
      activeDeliveryControllers.get(peerKey(userId, peerUserId))?.abort();
      activeDeliveryControllers.delete(peerKey(userId, peerUserId));
    });
    await Promise.all([
      ...ids.map((id) => SecureStore.deleteItemAsync(messageKey(userId, id))),
      ...epochPeers.map((peerUserId) => SecureStore.deleteItemAsync(peerEpochKey(userId, peerUserId))),
    ]);
    await SecureStore.deleteItemAsync(indexKey(userId));
    await SecureStore.deleteItemAsync(peerEpochIndexKey(userId));
  });
}
