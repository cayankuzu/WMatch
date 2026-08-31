const mockStorageValues = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorageValues.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorageValues.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStorageValues.delete(key);
  }),
}));

jest.mock('../../src/services/tmdb', () => ({
  getMovieKey: (movie: { id: number; mediaType?: string }) => `${movie.mediaType ?? 'movie'}:${movie.id}`,
  legacyMovieIdsToRefs: (ids: number[]) => ids.map((id) => ({ id, mediaType: 'movie' })),
  movieToMediaRef: (movie: { id: number; mediaType?: string }) => ({
    id: movie.id,
    mediaType: movie.mediaType ?? 'movie',
  }),
}));

import {
  cancelMovieSyncPayload,
  isMovieSyncPayloadDeliverable,
  markMovieSyncPayloadFailure,
  readMovieSyncOutbox,
  resetMovieSyncPayloadDelivery,
  writeMovieSyncOutbox,
  type MovieSyncPayload,
} from '../../src/context/app/librarySupport';

const STORAGE_KEY = 'wmatch:movie-sync-outbox:test-user';
const BASE_TIME = Date.UTC(2026, 0, 1);

function payload(overrides: Partial<MovieSyncPayload> = {}): MovieSyncPayload {
  return {
    favoriteMedia: [{ id: 1, mediaType: 'movie' }],
    watchedMedia: [{ id: 2, mediaType: 'tv' }],
    watchingId: null,
    watchingMediaType: null,
    idempotencyKey: 'wmatch:movie-sync:test-user:stable-id',
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

describe('movie library sync outbox', () => {
  beforeEach(() => {
    mockStorageValues.clear();
    jest.useFakeTimers().setSystemTime(new Date(BASE_TIME));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('upgrades a legacy persisted payload without changing its idempotency contract', async () => {
    mockStorageValues.set(STORAGE_KEY, JSON.stringify(payload()));

    await expect(readMovieSyncOutbox(STORAGE_KEY)).resolves.toEqual([
      expect.objectContaining({
        idempotencyKey: 'wmatch:movie-sync:test-user:stable-id',
        retryCount: 0,
        nextAttemptAt: null,
        deliveryStatus: 'pending',
      }),
    ]);
  });

  it('persists a bounded next-attempt schedule and dead-letters at the 24-hour boundary', () => {
    const firstFailure = markMovieSyncPayloadFailure(resetMovieSyncPayloadDelivery(payload()), BASE_TIME);
    expect(firstFailure).toMatchObject({
      retryCount: 1,
      nextAttemptAt: BASE_TIME + 1_000,
      deliveryStatus: 'pending',
    });
    expect(isMovieSyncPayloadDeliverable(firstFailure, BASE_TIME)).toBe(false);
    expect(isMovieSyncPayloadDeliverable(firstFailure, BASE_TIME + 1_000)).toBe(true);

    const after24Hours = markMovieSyncPayloadFailure(firstFailure, BASE_TIME + (24 * 60 * 60 * 1000));
    expect(after24Hours).toMatchObject({
      retryCount: 2,
      nextAttemptAt: null,
      deliveryStatus: 'dead-letter',
    });
    expect(isMovieSyncPayloadDeliverable(after24Hours, BASE_TIME + (24 * 60 * 60 * 1000))).toBe(false);
  });

  it('replays persisted work before 24 hours and retains explicit cancel state', async () => {
    const pending = resetMovieSyncPayloadDelivery(payload());
    await writeMovieSyncOutbox(STORAGE_KEY, [pending]);

    jest.setSystemTime(new Date(BASE_TIME + (23 * 60 * 60 * 1000) + (59 * 60 * 1000)));
    const [restored] = await readMovieSyncOutbox(STORAGE_KEY);
    expect(isMovieSyncPayloadDeliverable(restored)).toBe(true);

    const cancelled = cancelMovieSyncPayload(restored);
    await writeMovieSyncOutbox(STORAGE_KEY, [cancelled]);
    await expect(readMovieSyncOutbox(STORAGE_KEY)).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: 'cancelled', nextAttemptAt: null }),
    ]);
  });

  it('removes retained tombstones after seven days', async () => {
    mockStorageValues.set(STORAGE_KEY, JSON.stringify(payload({ updatedAt: BASE_TIME })));
    jest.setSystemTime(new Date(BASE_TIME + (8 * 24 * 60 * 60 * 1000)));

    await expect(readMovieSyncOutbox(STORAGE_KEY)).resolves.toEqual([]);
    expect(mockStorageValues.has(STORAGE_KEY)).toBe(false);
  });
});
