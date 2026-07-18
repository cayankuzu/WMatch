const mockGetChats = jest.fn();
const mockGetChatThread = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    multiRemove: jest.fn(async () => undefined),
  },
}));

jest.mock('../../src/services/api', () => ({
  getChats: (...args: unknown[]) => mockGetChats(...args),
  getChatThread: (...args: unknown[]) => mockGetChatThread(...args),
}));

jest.mock('expo-image', () => ({
  Image: { prefetch: jest.fn(async () => true) },
}));

import {
  preloadChatThread,
  preloadChatList,
  readChatThreadCache,
  writeChatThreadCache,
} from '../../src/services/chatCache';
import type { ApiChat, ApiChatThread, ApiMessage } from '../../src/services/api';
import { clearSessionCaches } from '../../src/shared/utils/sessionCache';

function createChat(userId: string, lastMessageTime: string) {
  return {
    userId,
    lastMessageTime,
    user: { photos: [] },
  } as ApiChat;
}

function createMessage(index: number) {
  return {
    id: `message-${index}`,
    text: `Message ${index}`,
    sender_id: 'current-user',
    receiver_id: 'other-user',
    created_at: new Date(2026, 0, 1, 0, index).toISOString(),
    read: true,
  } as ApiMessage;
}

describe('chat warm cache', () => {
  beforeEach(() => {
    clearSessionCaches();
    mockGetChats.mockReset();
    mockGetChatThread.mockReset();
  });

  it('deduplicates concurrent list warmups and sorts the cached result by activity', async () => {
    mockGetChats.mockResolvedValue({
      chats: [
        createChat('older', '2026-01-01T00:00:00.000Z'),
        createChat('newer', '2026-01-02T00:00:00.000Z'),
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    });

    const [first, second] = await Promise.all([
      preloadChatList('current-user'),
      preloadChatList('current-user'),
    ]);

    expect(mockGetChats).toHaveBeenCalledTimes(1);
    expect(first.chats.map((chat) => chat.userId)).toEqual(['newer', 'older']);
    expect(second.chats.map((chat) => chat.userId)).toEqual(['newer', 'older']);
  });

  it('never restores more than the latest 33 messages from the warm cache', () => {
    const messages = Array.from({ length: 66 }, (_, index) => createMessage(index));
    const thread = {
      chat: createChat('other-user', '2026-01-01T01:05:00.000Z'),
      messages,
      pageInfo: { hasMore: true, nextCursor: 'older-page' },
    } as ApiChatThread;

    writeChatThreadCache('current-user', 'other-user', thread);

    const cached = readChatThreadCache('current-user', 'other-user');
    expect(cached?.messages).toHaveLength(33);
    expect(cached?.messages[0]?.id).toBe('message-33');
    expect(cached?.messages.at(-1)?.id).toBe('message-65');
  });

  it('shares a thread request started by press intent with the opened modal', async () => {
    let resolveThread: ((thread: ApiChatThread) => void) | null = null;
    const threadPromise = new Promise<ApiChatThread>((resolve) => {
      resolveThread = resolve;
    });
    mockGetChatThread.mockReturnValue(threadPromise);

    const intentRequest = preloadChatThread('current-user', 'other-user');
    const modalRequest = preloadChatThread('current-user', 'other-user');

    expect(mockGetChatThread).toHaveBeenCalledTimes(1);

    const thread = {
      chat: createChat('other-user', '2026-01-01T01:05:00.000Z'),
      messages: [createMessage(0)],
      pageInfo: { hasMore: false, nextCursor: null },
    } as ApiChatThread;
    resolveThread?.(thread);

    await expect(intentRequest).resolves.toBe(thread);
    await expect(modalRequest).resolves.toBe(thread);
  });
});
