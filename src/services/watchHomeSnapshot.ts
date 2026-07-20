import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Movie } from './tmdb';

interface WatchHomeSnapshot {
  movies: Movie[];
  tvShows: Movie[];
  updatedAt: number;
}

const STORAGE_KEY = 'wmatch:watch-home:v1';
const MAX_STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let memorySnapshot: WatchHomeSnapshot | null = null;
let hydrationFlight: Promise<WatchHomeSnapshot | null> | null = null;
let mutationFlight = Promise.resolve();

function isValidSnapshot(value: unknown): value is WatchHomeSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<WatchHomeSnapshot>;
  return Array.isArray(snapshot.movies) &&
    Array.isArray(snapshot.tvShows) &&
    Number.isFinite(snapshot.updatedAt) &&
    Date.now() - Number(snapshot.updatedAt) <= MAX_STALE_AGE_MS;
}

export function readWatchHomeSnapshot() {
  if (memorySnapshot) {
    return Promise.resolve(memorySnapshot);
  }

  if (hydrationFlight) {
    return hydrationFlight;
  }

  hydrationFlight = AsyncStorage.getItem(STORAGE_KEY)
    .then(async (rawValue) => {
      if (!rawValue) {
        return null;
      }

      try {
        const parsedValue = JSON.parse(rawValue) as unknown;
        if (!isValidSnapshot(parsedValue)) {
          await AsyncStorage.removeItem(STORAGE_KEY);
          return null;
        }

        memorySnapshot = parsedValue;
        return parsedValue;
      } catch {
        await AsyncStorage.removeItem(STORAGE_KEY);
        return null;
      }
    })
    .catch(() => null)
    .finally(() => {
      hydrationFlight = null;
    });

  return hydrationFlight;
}

export function updateWatchHomeSnapshot(
  update: Partial<Pick<WatchHomeSnapshot, 'movies' | 'tvShows'>>,
) {
  mutationFlight = mutationFlight.then(async () => {
    const current = memorySnapshot ?? await readWatchHomeSnapshot();
    const next: WatchHomeSnapshot = {
      movies: update.movies ?? current?.movies ?? [],
      tvShows: update.tvShows ?? current?.tvShows ?? [],
      updatedAt: Date.now(),
    };

    memorySnapshot = next;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }).catch(() => undefined);

  return mutationFlight;
}
