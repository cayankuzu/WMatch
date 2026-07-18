const mockSecureValues = new Map<string, string>();
const mockSendMessage = jest.fn();
const mockCaptureException = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureValues.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureValues.delete(key);
  }),
}));

jest.mock('../../src/services/api', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

jest.mock('../../src/services/telemetry', () => ({
  telemetry: {
    captureException: (...args: unknown[]) => mockCaptureException(...args),
  },
}));

import {
  enqueuePendingChatMessage,
  flushPendingChatMessages,
  listPendingChatMessages,
  purgeChatOutbox,
} from '../../src/services/chatOutbox';

const USER_ID = 'user-00000001';
const OTHER_USER_ID = 'user-00000002';
const PEER_ID = 'peer-00000001';

function pending(clientMessageId: string, text: string, offsetMs: number) {
  return {
    clientMessageId,
    peerUserId: PEER_ID,
    text,
    createdAt: new Date(Date.UTC(2026, 0, 1) + offsetMs).toISOString(),
  };
}

describe('encrypted chat outbox', () => {
  beforeEach(() => {
    mockSecureValues.clear();
    mockSendMessage.mockReset();
    mockCaptureException.mockReset();
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 2)));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores normalized messages in creation order and isolates users', async () => {
    await enqueuePendingChatMessage(USER_ID, pending('message-00000002', ' ikinci ', 2_000));
    await enqueuePendingChatMessage(USER_ID, pending('message-00000001', 'ilk', 1_000));
    await enqueuePendingChatMessage(OTHER_USER_ID, {
      ...pending('message-00000003', 'başka hesap', 3_000),
      peerUserId: USER_ID,
    });

    await expect(listPendingChatMessages(USER_ID)).resolves.toEqual([
      expect.objectContaining({ clientMessageId: 'message-00000001', text: 'ilk' }),
      expect.objectContaining({ clientMessageId: 'message-00000002', text: 'ikinci' }),
    ]);
    await expect(listPendingChatMessages(OTHER_USER_ID)).resolves.toHaveLength(1);
  });

  it('flushes sequentially with stable client IDs and preserves the failed tail', async () => {
    await enqueuePendingChatMessage(USER_ID, pending('message-00000001', 'ilk', 1_000));
    await enqueuePendingChatMessage(USER_ID, pending('message-00000002', 'ikinci', 2_000));
    mockSendMessage
      .mockResolvedValueOnce({ id: 'server-1' })
      .mockRejectedValueOnce(new Error('offline'));

    await expect(flushPendingChatMessages(USER_ID)).resolves.toBe(1);
    expect(mockSendMessage.mock.calls).toEqual([
      [PEER_ID, 'ilk', 'message-00000001'],
      [PEER_ID, 'ikinci', 'message-00000002'],
    ]);
    await expect(listPendingChatMessages(USER_ID)).resolves.toEqual([
      expect.objectContaining({ clientMessageId: 'message-00000002' }),
    ]);
  });

  it('purges only the selected account and rejects unsafe persisted payloads', async () => {
    await enqueuePendingChatMessage(USER_ID, pending('message-00000001', 'ilk', 1_000));
    await enqueuePendingChatMessage(OTHER_USER_ID, {
      ...pending('message-00000002', 'ikinci', 2_000),
      peerUserId: USER_ID,
    });

    await purgeChatOutbox(USER_ID);

    await expect(listPendingChatMessages(USER_ID)).resolves.toEqual([]);
    await expect(listPendingChatMessages(OTHER_USER_ID)).resolves.toHaveLength(1);
    await expect(
      enqueuePendingChatMessage(USER_ID, pending('../unsafe', 'metin', 3_000)),
    ).rejects.toThrow('Invalid chat outbox message identifier.');
  });
});
