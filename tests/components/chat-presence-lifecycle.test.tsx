import { act, renderHook } from '@testing-library/react-native';

let mockSubscribed = false;
const mockTrack = jest.fn(async () => 'ok');
const mockUntrack = jest.fn(async () => 'ok');
const mockSend = jest.fn(async () => 'ok');
const mockTeardown = jest.fn();
const mockPresenceState = jest.fn(() => ({}));
const mockOn = jest.fn((type: string) => {
  if (mockSubscribed && type === 'presence') {
    throw new Error('cannot add presence callbacks after subscribe()');
  }

  return mockChannel;
});
const mockSubscribe = jest.fn((listener?: (status: string) => void) => {
  mockSubscribed = true;
  listener?.('SUBSCRIBED');
  return mockChannel;
});
const mockChannel = {
  on: (...args: Parameters<typeof mockOn>) => mockOn(...args),
  subscribe: (...args: Parameters<typeof mockSubscribe>) => mockSubscribe(...args),
  track: (...args: unknown[]) => mockTrack(...args),
  untrack: () => mockUntrack(),
  send: (...args: unknown[]) => mockSend(...args),
  presenceState: () => mockPresenceState(),
  teardown: () => mockTeardown(),
};
const mockCreateChannel = jest.fn(() => mockChannel);
const mockRemoveChannel = jest.fn(async () => 'ok');

jest.mock('../../utils/supabase/client', () => ({
  supabase: {
    channel: (...args: unknown[]) => mockCreateChannel(...args),
    removeChannel: (...args: unknown[]) => mockRemoveChannel(...args),
  },
}));

import useChatPresence from '../../src/app/hooks/useChatPresence';

const hookProps = {
  currentUserId: 'user-00000001',
  otherUserId: 'user-00000002',
  isTyping: false,
};

describe('chat presence lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSubscribed = false;
    mockTrack.mockClear();
    mockUntrack.mockClear();
    mockSend.mockClear();
    mockTeardown.mockClear();
    mockPresenceState.mockClear();
    mockOn.mockClear();
    mockSubscribe.mockClear();
    mockCreateChannel.mockClear();
    mockRemoveChannel.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reuses the subscribed pair channel when a chat is closed and immediately reopened', async () => {
    const firstMount = await renderHook(() => useChatPresence(hookProps));
    await act(async () => Promise.resolve());

    await firstMount.unmount();

    const secondMount = await renderHook(() => useChatPresence(hookProps));
    await act(async () => Promise.resolve());

    expect(mockCreateChannel).toHaveBeenCalledTimes(2);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockOn).toHaveBeenCalledTimes(4);
    expect(mockRemoveChannel).not.toHaveBeenCalled();

    await secondMount.unmount();
    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
    });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(2);
  });
});
