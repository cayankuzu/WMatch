const mockStorage = new Map<string, string>();
const mockFetchWithRetry = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockStorage.keys()]),
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    multiGet: jest.fn(async (keys: string[]) => keys.map((key) => [key, mockStorage.get(key) ?? null])),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
  },
}));

jest.mock('expo-image', () => ({
  Image: { prefetch: jest.fn(async () => true) },
}));

jest.mock('../../utils/supabase/client', () => ({
  API_BASE: 'https://api.example.test',
  fetchWithRetry: (...args: [string, RequestInit?]) => mockFetchWithRetry(...args),
}));

jest.mock('../../utils/supabase/info', () => ({
  publicAnonKey: 'test-anon-key',
}));

import { tmdbService } from '../../src/services/tmdb';

describe('TMDB stale-while-revalidate cache', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockFetchWithRetry.mockReset();
  });

  it('returns a valid stale payload without waiting for the background request', async () => {
    const path = '/movie/popular?language=tr-TR&page=1';
    const cacheKey = `wmatch:tmdb-response:${encodeURIComponent(path)}`;
    const stalePayload = {
      page: 1,
      results: [{ id: 42, title: 'Cached', poster_path: null, vote_average: 8 }],
      total_pages: 1,
      total_results: 1,
    };
    mockStorage.set(cacheKey, JSON.stringify({
      value: stalePayload,
      expiresAt: Date.now() - 1_000,
      storedAt: Date.now() - 2_000,
    }));

    let finishRefresh: ((response: Response) => void) | undefined;
    mockFetchWithRetry.mockReturnValue(new Promise<Response>((resolve) => {
      finishRefresh = resolve;
    }));

    const result = await tmdbService.getPopularMovies(1);

    expect(result.results).toEqual([expect.objectContaining({ id: 42, title: 'Cached' })]);
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1);

    finishRefresh?.(new Response(JSON.stringify(stalePayload), { status: 200 }));
    await Promise.resolve();
  });
});
