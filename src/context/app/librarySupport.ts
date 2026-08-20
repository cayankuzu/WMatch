import AsyncStorage from '@react-native-async-storage/async-storage';

import { storageKeys } from '../../shared/constants/storage';
import type { MediaRef, MediaType } from '../../shared/types';
import { getMovieKey, legacyMovieIdsToRefs, movieToMediaRef, type Movie } from '../../services/tmdb';

const LIBRARY_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

export interface PausedWatchingEntry {
  movie: Movie;
  remainingWatchMs: number;
}

export interface MovieSyncPayload {
  favoriteMedia: MediaRef[];
  watchedMedia: MediaRef[];
  favoriteIds?: number[];
  watchedIds?: number[];
  watchingId: number | null;
  watchingMediaType: MediaType | null;
  watchingAction?: 'start' | 'pause' | 'resume' | 'stop';
  watchingVersion?: number | null;
  idempotencyKey: string;
  updatedAt: number;
}

interface LibrarySnapshot {
  updatedAt: number;
  favorites: Movie[];
  watched: Movie[];
}

const isCachedMovie = (value: unknown): value is Movie => {
  if (!value || typeof value !== 'object') return false;
  const movie = value as Partial<Movie>;
  return Number.isInteger(movie.id) && Number(movie.id) > 0;
};

export async function readLibrarySnapshot(userId: string): Promise<LibrarySnapshot | null> {
  try {
    const key = storageKeys.librarySnapshot(userId);
    const rawValue = await AsyncStorage.getItem(key);
    if (!rawValue) return null;
    const snapshot = JSON.parse(rawValue) as Partial<LibrarySnapshot>;
    if (
      !Number.isFinite(snapshot.updatedAt)
      || Date.now() - Number(snapshot.updatedAt) > LIBRARY_SNAPSHOT_TTL_MS
      || !Array.isArray(snapshot.favorites)
      || !snapshot.favorites.every(isCachedMovie)
      || !Array.isArray(snapshot.watched)
      || !snapshot.watched.every(isCachedMovie)
    ) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return snapshot as LibrarySnapshot;
  } catch (error) {
    console.warn('Movie library snapshot could not be restored:', error);
    return null;
  }
}

export function writeLibrarySnapshot(userId: string, favorites: Movie[], watched: Movie[]) {
  const snapshot: LibrarySnapshot = { updatedAt: Date.now(), favorites, watched };
  return AsyncStorage.setItem(storageKeys.librarySnapshot(userId), JSON.stringify(snapshot));
}

export function deleteLibrarySnapshot(userId: string) {
  return AsyncStorage.removeItem(storageKeys.librarySnapshot(userId));
}

export const ensureMovieInList = (movies: Movie[], movie: Movie | null) => {
  if (!movie || movies.some((item) => getMovieKey(item) === getMovieKey(movie))) return movies;
  return [movie, ...movies];
};

const getMovieInputKey = (movie: Movie | number) => typeof movie === 'number' ? null : getMovieKey(movie);

export function filterMoviesByInput(movies: Movie[], movie: Movie | number) {
  const movieKey = getMovieInputKey(movie);
  return movieKey
    ? movies.filter((item) => getMovieKey(item) !== movieKey)
    : movies.filter((item) => item.id !== movie);
}

export function hasMovieInput(movies: Movie[], movie: Movie | number) {
  const movieKey = getMovieInputKey(movie);
  return movieKey
    ? movies.some((item) => getMovieKey(item) === movieKey)
    : movies.some((item) => item.id === movie);
}

export const moviesToRefs = (movies: Movie[]) => movies.map(movieToMediaRef);

export function normalizeMediaRefs(value: unknown, legacyIds: number[] = []): MediaRef[] {
  if (!Array.isArray(value)) return legacyMovieIdsToRefs(legacyIds);
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const id = (item as { id?: unknown }).id;
    const mediaType = (item as { mediaType?: unknown }).mediaType;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || (mediaType !== 'movie' && mediaType !== 'tv')) {
      return [];
    }
    const key = `${mediaType}:${id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id, mediaType }];
  });
}

export async function readPausedWatching(
  storageKey: string | null,
  fallbackDurationMs: number,
): Promise<PausedWatchingEntry | null> {
  if (!storageKey) return null;
  try {
    const rawValue = await AsyncStorage.getItem(storageKey);
    if (!rawValue) return null;
    const value = JSON.parse(rawValue) as Partial<PausedWatchingEntry> & Partial<Movie>;
    if (value.movie && Number.isFinite(value.remainingWatchMs)) {
      return { movie: value.movie, remainingWatchMs: Math.max(0, Number(value.remainingWatchMs)) };
    }
    if (Number.isInteger(value.id)) {
      return { movie: value as Movie, remainingWatchMs: fallbackDurationMs };
    }
  } catch (error) {
    console.warn('Paused watching movie could not be restored:', error);
  }
  return null;
}

export async function writePausedWatching(storageKey: string | null, entry: PausedWatchingEntry | null) {
  if (!storageKey) return;
  try {
    if (entry) await AsyncStorage.setItem(storageKey, JSON.stringify(entry));
    else await AsyncStorage.removeItem(storageKey);
  } catch (error) {
    console.warn('Paused watching movie could not be persisted:', error);
  }
}

export async function readMovieSyncOutbox(storageKey: string | null): Promise<MovieSyncPayload[]> {
  if (!storageKey) return [];
  try {
    const rawValue = await AsyncStorage.getItem(storageKey);
    if (!rawValue) return [];
    const value = JSON.parse(rawValue) as Partial<MovieSyncPayload> | Partial<MovieSyncPayload>[];
    return (Array.isArray(value) ? value : [value]).flatMap((entry) => {
      if (
        (!Array.isArray(entry.favoriteMedia) && !Array.isArray(entry.favoriteIds))
        || (!Array.isArray(entry.watchedMedia) && !Array.isArray(entry.watchedIds))
        || typeof entry.idempotencyKey !== 'string'
        || typeof entry.updatedAt !== 'number'
      ) return [];
      const watchingId = Number.isInteger(entry.watchingId) ? entry.watchingId as number : null;
      const action = entry.watchingAction;
      return [{
        favoriteMedia: normalizeMediaRefs(entry.favoriteMedia, entry.favoriteIds),
        watchedMedia: normalizeMediaRefs(entry.watchedMedia, entry.watchedIds),
        watchingId,
        watchingMediaType: entry.watchingMediaType === 'tv' ? 'tv' : watchingId ? 'movie' : null,
        watchingAction: action === 'start' || action === 'pause' || action === 'resume' || action === 'stop'
          ? action
          : undefined,
        watchingVersion: typeof entry.watchingVersion === 'number' ? entry.watchingVersion : null,
        idempotencyKey: entry.idempotencyKey,
        updatedAt: entry.updatedAt,
      }];
    });
  } catch (error) {
    console.warn('Movie sync outbox could not be restored:', error);
    return [];
  }
}

export async function writeMovieSyncOutbox(storageKey: string | null, queue: MovieSyncPayload[]) {
  if (!storageKey) return;
  if (queue.length === 0) await AsyncStorage.removeItem(storageKey);
  else await AsyncStorage.setItem(storageKey, JSON.stringify(queue));
}
