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
      refreshSession: vi.fn(async () => ({
        data: { session: { access_token: 'refreshed-token' } },
        error: null,
      })),
    },
  })),
}));

vi.mock('../utils/supabase/info', () => ({
  apiGatewayBaseUrl: 'https://edge.example.test',
  projectId: 'test-project',
  publicAnonKey: 'test-anon-key',
}));

import {
  fetchWithRetry,
  refreshAuthSessionSingleFlight,
  RequestTimeoutError,
  resolveApiUrl,
  shouldUseEdgeGateway,
  supabase,
} from '../utils/supabase/client';

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

describe('selective edge routing', () => {
  it('routes only the security and public metadata allowlist through the stable gateway', () => {
    expect(resolveApiUrl('/tmdb/trending/all/week')).toBe(
      'https://edge.example.test/tmdb/trending/all/week',
    );
    expect(resolveApiUrl('/auth/password-reset')).toBe(
      'https://edge.example.test/auth/password-reset',
    );
    expect(resolveApiUrl('/reports')).toBe('https://edge.example.test/reports');
    expect(shouldUseEdgeGateway('/messages/peer-id')).toBe(false);
    expect(resolveApiUrl('/messages/peer-id')).toBe(
      'https://test-project.supabase.co/functions/v1/make-server-d962235e/messages/peer-id',
    );
  });

  it('rejects ambiguous non-rooted API paths', () => {
    expect(() => resolveApiUrl('tmdb/trending/all/week')).toThrow(
      'API paths must start with a forward slash.',
    );
  });
});

describe('authentication refresh coordination', () => {
  it('coalesces concurrent refresh callers into one provider request', async () => {
    let resolveRefresh: ((value: unknown) => void) | undefined;
    const refreshResult = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshSession = vi.mocked(supabase.auth.refreshSession);
    refreshSession.mockReturnValueOnce(refreshResult as ReturnType<typeof supabase.auth.refreshSession>);

    const first = refreshAuthSessionSingleFlight();
    const second = refreshAuthSessionSingleFlight();
    expect(first).toBe(second);
    expect(refreshSession).toHaveBeenCalledTimes(1);

    resolveRefresh?.({ data: { session: { access_token: 'fresh-token' } }, error: null });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
