jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();

  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

jest.mock('../../utils/supabase/info', () => ({
  projectId: 'test-project',
  publicAnonKey: 'test-anon-key',
}));

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { fetchWithRetry } from '../../utils/supabase/client';

describe('network fault and retry contract', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('never retries a non-idempotent mutation after a transport failure', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    global.fetch = fetchMock as typeof fetch;

    await expect(fetchWithRetry('https://example.test/mutation', { method: 'POST' }))
      .rejects.toThrow('Network request failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent mutation with the same request headers', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
    const request = fetchWithRetry('https://example.test/mutation', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'stable-action-key' },
    });

    await jest.runAllTimersAsync();
    await expect(request).resolves.toHaveProperty('status', 200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get('Idempotency-Key')))
      .toEqual(['stable-action-key', 'stable-action-key', 'stable-action-key']);
  });

  it('honors retryable HTTP responses without exposing a fake success', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    global.fetch = fetchMock as typeof fetch;
    const request = fetchWithRetry('https://example.test/read');

    await jest.runAllTimersAsync();
    await expect(request).resolves.toHaveProperty('status', 200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a caller-cancelled request', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      if (init?.signal?.aborted) {
        throw error;
      }
      throw error;
    });
    global.fetch = fetchMock as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    await expect(fetchWithRetry('https://example.test/read', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
