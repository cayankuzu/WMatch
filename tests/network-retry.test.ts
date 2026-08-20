import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: vi.fn(async () => true),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  })),
}));

vi.mock('../utils/supabase/info', () => ({
  projectId: 'test-project',
  publicAnonKey: 'test-anon-key',
}));

import { fetchWithRetry, RequestTimeoutError } from '../utils/supabase/client';

function createAbortAwareFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const rejectWithAbort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };

    if (init?.signal?.aborted) {
      rejectWithAbort();
      return;
    }

    init?.signal?.addEventListener('abort', rejectWithAbort, { once: true });
  }));
}

describe('fetchWithRetry cancellation semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries internal timeouts and returns a typed timeout after the policy is exhausted', async () => {
    const fetchMock = createAbortAwareFetch();
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchWithRetry('https://example.test/timeout', { method: 'GET' });
    const assertion = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);

    await vi.advanceTimersByTimeAsync(25_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry an explicit caller cancellation', async () => {
    const fetchMock = createAbortAwareFetch();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const request = fetchWithRetry('https://example.test/cancelled', {
      method: 'GET',
      signal: controller.signal,
    });
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
