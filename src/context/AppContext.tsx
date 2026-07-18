import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { API_BASE, fetchWithRetry, getAuthHeaders } from '../../utils/supabase/client';
import {
  getMovieKey,
  legacyMovieIdsToRefs,
  movieToMediaRef,
  tmdbService,
  type Movie,
} from '../services/tmdb';
import type { MediaRef, MediaType } from '../shared/types';
import { getServerNowIsoString, getServerNowMs, syncServerTimeFromHeaders } from '../shared/utils/serverTime';
import { telemetry } from '../services/telemetry';
import { useAuth } from './AuthContext';

interface AppContextType {
  currentlyWatching: Movie | null;
  activeWatching: Movie | null;
  currentlyWatchingUpdatedAt: string | null;
  watchingState: 'idle' | 'active' | 'paused';
  favorites: Movie[];
  watched: Movie[];
  libraryLoading: boolean;
  libraryError: string | null;
  watchingExpiredNotice: string | null;
  setCurrentlyWatching: (movie: Movie) => void;
  pauseCurrentlyWatching: () => void;
  resumeCurrentlyWatching: () => void;
  addToFavorites: (movie: Movie) => void;
  removeFromFavorites: (movie: Movie | number) => void;
  isFavorite: (movie: Movie | number) => boolean;
  addToWatched: (movie: Movie) => void;
  removeFromWatched: (movie: Movie | number) => void;
  isWatched: (movie: Movie | number) => boolean;
  dismissWatchingExpiredNotice: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
const WATCH_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const PAUSED_WATCHING_STORAGE_PREFIX = 'wmatch:paused-watching:';
const MOVIE_SYNC_OUTBOX_PREFIX = 'wmatch:movie-sync-outbox:';
const LIBRARY_SNAPSHOT_STORAGE_PREFIX = 'wmatch:library-snapshot:';
const LIBRARY_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_SYNC_DEBOUNCE_MS = 400;
const MOVIE_HYDRATION_BATCH_SIZE = 8;
const UNKNOWN_LIBRARY_ERROR = 'data.error.generic';
const WATCHING_EXPIRED_NOTICE =
  'Bir içerik en fazla 12 saat boyunca "Şu anda izleniyor" alanında kalabilir. Süre dolduğu için otomatik olarak durduruldu.';

type PausedWatchingEntry = {
  movie: Movie;
  remainingWatchMs: number;
};

type MovieSyncPayload = {
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
};

type LibrarySnapshot = {
  updatedAt: number;
  favorites: Movie[];
  watched: Movie[];
};

const isCachedMovie = (value: unknown): value is Movie => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const movie = value as Partial<Movie>;
  return Number.isInteger(movie.id) && Number(movie.id) > 0;
};

async function readLibrarySnapshot(userId: string): Promise<LibrarySnapshot | null> {
  try {
    const rawValue = await AsyncStorage.getItem(`${LIBRARY_SNAPSHOT_STORAGE_PREFIX}${userId}`);
    if (!rawValue) {
      return null;
    }

    const snapshot = JSON.parse(rawValue) as Partial<LibrarySnapshot>;
    if (
      !Number.isFinite(snapshot.updatedAt) ||
      Date.now() - Number(snapshot.updatedAt) > LIBRARY_SNAPSHOT_TTL_MS ||
      !Array.isArray(snapshot.favorites) ||
      !snapshot.favorites.every(isCachedMovie) ||
      !Array.isArray(snapshot.watched) ||
      !snapshot.watched.every(isCachedMovie)
    ) {
      await AsyncStorage.removeItem(`${LIBRARY_SNAPSHOT_STORAGE_PREFIX}${userId}`);
      return null;
    }

    return snapshot as LibrarySnapshot;
  } catch (error) {
    console.warn('Movie library snapshot could not be restored:', error);
    return null;
  }
}

const ensureMovieInList = (movies: Movie[], movie: Movie | null) => {
  if (!movie || movies.some((item) => getMovieKey(item) === getMovieKey(movie))) {
    return movies;
  }

  return [...movies, movie];
};

const getMovieInputKey = (movie: Movie | number) => (
  typeof movie === 'number' ? null : getMovieKey(movie)
);

const filterMoviesByInput = (movies: Movie[], movie: Movie | number) => {
  const movieKey = getMovieInputKey(movie);

  if (movieKey) {
    return movies.filter((item) => getMovieKey(item) !== movieKey);
  }

  return movies.filter((item) => item.id !== movie);
};

const hasMovieInput = (movies: Movie[], movie: Movie | number) => {
  const movieKey = getMovieInputKey(movie);

  if (movieKey) {
    return movies.some((item) => getMovieKey(item) === movieKey);
  }

  return movies.some((item) => item.id === movie);
};

const moviesToRefs = (movies: Movie[]) => movies.map(movieToMediaRef);

const normalizeMediaRefs = (value: unknown, legacyIds: number[] = []): MediaRef[] => {
  if (!Array.isArray(value)) {
    return legacyMovieIdsToRefs(legacyIds);
  }

  const seen = new Set<string>();
  const refs: MediaRef[] = [];

  value.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const id = (item as { id?: unknown }).id;
    const mediaType = (item as { mediaType?: unknown }).mediaType;

    if (
      typeof id !== 'number' ||
      !Number.isInteger(id) ||
      id <= 0 ||
      (mediaType !== 'movie' && mediaType !== 'tv')
    ) {
      return;
    }

    const key = `${mediaType}:${id}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    refs.push({ id, mediaType });
  });

  return refs;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const [currentlyWatching, setCurrentlyWatchingState] = useState<Movie | null>(null);
  const [activeWatching, setActiveWatching] = useState<Movie | null>(null);
  const [currentlyWatchingUpdatedAt, setCurrentlyWatchingUpdatedAt] = useState<string | null>(null);
  const [watchingState, setWatchingState] = useState<'idle' | 'active' | 'paused'>('idle');
  const [favorites, setFavorites] = useState<Movie[]>([]);
  const [watched, setWatched] = useState<Movie[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [watchingExpiredNotice, setWatchingExpiredNotice] = useState<string | null>(null);
  const [pausedWatching, setPausedWatching] = useState<PausedWatchingEntry | null>(null);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncPayloadRef = useRef<MovieSyncPayload | null>(null);
  const outboxMutationRef = useRef<Promise<unknown>>(Promise.resolve());
  const syncInFlightRef = useRef(false);
  const flushRequestedRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(user?.id ?? null);
  const flushMovieSyncOutboxRef = useRef<() => Promise<void>>(async () => undefined);
  const watchingVersionRef = useRef<number | null>(user?.currentlyWatchingVersion ?? null);
  const libraryCacheMutationRef = useRef<Promise<void>>(Promise.resolve());

  activeUserIdRef.current = user?.id ?? null;

  const pausedWatchingStorageKey = user ? `${PAUSED_WATCHING_STORAGE_PREFIX}${user.id}` : null;
  const movieSyncOutboxKey = user ? `${MOVIE_SYNC_OUTBOX_PREFIX}${user.id}` : null;

  const persistLibrarySnapshot = (nextFavorites: Movie[], nextWatched: Movie[]) => {
    const userId = activeUserIdRef.current;
    if (!userId) {
      return;
    }

    const snapshot: LibrarySnapshot = {
      updatedAt: Date.now(),
      favorites: nextFavorites,
      watched: nextWatched,
    };
    libraryCacheMutationRef.current = libraryCacheMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        const storageKey = `${LIBRARY_SNAPSHOT_STORAGE_PREFIX}${userId}`;

        if (activeUserIdRef.current !== userId) {
          return;
        }

        await AsyncStorage.setItem(storageKey, JSON.stringify(snapshot));

        if (activeUserIdRef.current !== userId) {
          await AsyncStorage.removeItem(storageKey);
        }
      })
      .catch((error) => {
        console.warn('Movie library snapshot could not be persisted:', error);
      });
  };

  const hydrateMovies = async (movieRefs: MediaRef[]) => {
    const movies = [];

    for (let index = 0; index < movieRefs.length; index += MOVIE_HYDRATION_BATCH_SIZE) {
      const batch = movieRefs.slice(index, index + MOVIE_HYDRATION_BATCH_SIZE);
      const resolvedBatch = await Promise.all(batch.map((movieRef) => tmdbService.getMediaByRef(movieRef)));
      movies.push(...resolvedBatch);
    }

    return movies.filter((movie): movie is Movie => movie != null);
  };

  const readPausedWatching = async () => {
    if (!pausedWatchingStorageKey) {
      return null;
    }

    try {
      const rawValue = await AsyncStorage.getItem(pausedWatchingStorageKey);
      if (!rawValue) {
        return null;
      }

      const parsedValue = JSON.parse(rawValue) as Partial<PausedWatchingEntry> & { movie?: Movie };

      if (
        parsedValue &&
        typeof parsedValue === 'object' &&
        parsedValue.movie &&
        typeof parsedValue.remainingWatchMs === 'number' &&
        Number.isFinite(parsedValue.remainingWatchMs)
      ) {
        return {
          movie: parsedValue.movie,
          remainingWatchMs: Math.max(0, parsedValue.remainingWatchMs),
        } satisfies PausedWatchingEntry;
      }

      if (parsedValue && typeof parsedValue === 'object' && 'id' in parsedValue) {
        return {
          movie: parsedValue as Movie,
          remainingWatchMs: WATCH_SESSION_DURATION_MS,
        } satisfies PausedWatchingEntry;
      }

      return null;
    } catch (error) {
      console.warn('Paused watching movie could not be restored:', error);
      return null;
    }
  };

  const persistPausedWatching = async (entry: PausedWatchingEntry | null) => {
    if (!pausedWatchingStorageKey) {
      return;
    }

    try {
      if (entry) {
        await AsyncStorage.setItem(pausedWatchingStorageKey, JSON.stringify(entry));
      } else {
        await AsyncStorage.removeItem(pausedWatchingStorageKey);
      }
    } catch (error) {
      console.warn('Paused watching movie could not be persisted:', error);
    }
  };

  const readMovieSyncOutbox = async (): Promise<MovieSyncPayload[]> => {
    if (!movieSyncOutboxKey) {
      return [];
    }

    try {
      const rawValue = await AsyncStorage.getItem(movieSyncOutboxKey);

      if (!rawValue) {
        return [];
      }

      const parsedValue = JSON.parse(rawValue) as Partial<MovieSyncPayload> | Partial<MovieSyncPayload>[];
      const entries = Array.isArray(parsedValue) ? parsedValue : [parsedValue];

      return entries.flatMap((entry) => {
        if (
          (!Array.isArray(entry.favoriteMedia) && !Array.isArray(entry.favoriteIds)) ||
          (!Array.isArray(entry.watchedMedia) && !Array.isArray(entry.watchedIds)) ||
          typeof entry.idempotencyKey !== 'string' ||
          typeof entry.updatedAt !== 'number'
        ) {
          return [];
        }

        const parsedWatchingId = entry.watchingId;
        return [{
          favoriteMedia: normalizeMediaRefs(entry.favoriteMedia, entry.favoriteIds),
          watchedMedia: normalizeMediaRefs(entry.watchedMedia, entry.watchedIds),
          watchingId: Number.isInteger(parsedWatchingId) ? parsedWatchingId as number : null,
          watchingMediaType: entry.watchingMediaType === 'tv' ? 'tv' : parsedWatchingId ? 'movie' : null,
          watchingAction:
            entry.watchingAction === 'start' ||
            entry.watchingAction === 'pause' ||
            entry.watchingAction === 'resume' ||
            entry.watchingAction === 'stop'
              ? entry.watchingAction
              : undefined,
          watchingVersion: typeof entry.watchingVersion === 'number' ? entry.watchingVersion : null,
          idempotencyKey: entry.idempotencyKey,
          updatedAt: entry.updatedAt,
        } satisfies MovieSyncPayload];
      });
    } catch (error) {
      console.warn('Movie sync outbox could not be restored:', error);
      return [];
    }
  };

  const writeMovieSyncOutbox = async (queue: MovieSyncPayload[]) => {
    if (!movieSyncOutboxKey) {
      return;
    }

    try {
      if (queue.length === 0) {
        await AsyncStorage.removeItem(movieSyncOutboxKey);
      } else {
        await AsyncStorage.setItem(movieSyncOutboxKey, JSON.stringify(queue));
      }
    } catch (error) {
      console.warn('Movie sync outbox could not be persisted:', error);
      throw error;
    }
  };

  const mutateMovieSyncOutbox = (
    mutation: (queue: MovieSyncPayload[]) => MovieSyncPayload[],
  ): Promise<MovieSyncPayload[]> => {
    const operation = outboxMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        const queue = await readMovieSyncOutbox();
        const nextQueue = mutation(queue);
        await writeMovieSyncOutbox(nextQueue);
        return nextQueue;
      });
    outboxMutationRef.current = operation;
    return operation;
  };

  const enqueueMovieSyncPayload = (payload: MovieSyncPayload) =>
    mutateMovieSyncOutbox((queue) => {
      if (payload.watchingAction) {
        return [...queue, payload];
      }

      return [...queue.filter((entry) => Boolean(entry.watchingAction)), payload];
    });

  const clearMovieSyncOutbox = (idempotencyKey: string) =>
    mutateMovieSyncOutbox((queue) => queue.filter((entry) => entry.idempotencyKey !== idempotencyKey));

  const isMatchingWatchConflict = (payload: MovieSyncPayload, conflict: Record<string, unknown>) => {
    const state = conflict.state;
    const mediaType = conflict.mediaType;
    const mediaId = conflict.movieId;

    if (payload.watchingAction === 'stop') {
      return state == null || state === 'idle';
    }

    const expectedState = payload.watchingAction === 'pause' ? 'paused' : 'active';
    return state === expectedState && mediaId === payload.watchingId && mediaType === payload.watchingMediaType;
  };

  const syncToDatabase = async (payload: MovieSyncPayload, expectedUserId: string): Promise<boolean> => {
    if (!user || activeUserIdRef.current !== expectedUserId) {
      return false;
    }

    try {
      const headers = await getAuthHeaders();

      if (activeUserIdRef.current !== expectedUserId) {
        return false;
      }

      const response = await fetchWithRetry(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Idempotency-Key': payload.idempotencyKey,
        },
        body: JSON.stringify({
          favoriteMovies: payload.favoriteMedia.map((item) => item.id),
          favoriteMedia: payload.favoriteMedia,
          watchedMovies: payload.watchedMedia.map((item) => item.id),
          watchedMedia: payload.watchedMedia,
          currentlyWatching: payload.watchingId,
          currentlyWatchingMediaType: payload.watchingMediaType,
          currentlyWatchingAction: payload.watchingAction,
          currentlyWatchingVersion: payload.watchingAction ? watchingVersionRef.current : null,
        }),
      });

      if (activeUserIdRef.current !== expectedUserId) {
        return false;
      }

      syncServerTimeFromHeaders(response.headers);
      const responsePayload = await response.json().catch(() => ({})) as {
        profile?: { currentlyWatchingVersion?: number | null };
        conflict?: Record<string, unknown> & { version?: number | null };
      };

      if (!response.ok) {
        if (response.status === 409 && payload.watchingAction && responsePayload.conflict) {
          const conflictVersion = responsePayload.conflict.version;
          if (typeof conflictVersion === 'number') {
            watchingVersionRef.current = conflictVersion;
          }

          if (!isMatchingWatchConflict(payload, responsePayload.conflict)) {
            setWatchingExpiredNotice('İzleme durumu başka bir cihazda değişti. En güncel durum yüklendi.');
            await refreshUser().catch(() => undefined);
          }

          return true;
        }

        throw new Error(`Movie sync failed with status ${response.status}`);
      }

      const nextWatchingVersion = responsePayload.profile?.currentlyWatchingVersion;
      if (typeof nextWatchingVersion === 'number') {
        watchingVersionRef.current = nextWatchingVersion;
      } else if (payload.watchingAction === 'stop') {
        watchingVersionRef.current = null;
      }

      return true;
    } catch (error) {
      console.error('Movie sync error:', error);
      return false;
    }
  };

  const scheduleDatabaseSync = (
    favoriteMedia: MediaRef[],
    watchedMedia: MediaRef[],
    watchingId: number | null,
    watchingMediaType: MediaType | null = null,
    watchingAction?: 'start' | 'pause' | 'resume' | 'stop',
  ) => {
    if (!user) {
      return;
    }

    const payload: MovieSyncPayload = {
      favoriteMedia,
      watchedMedia,
      favoriteIds: favoriteMedia.map((item) => item.id),
      watchedIds: watchedMedia.map((item) => item.id),
      watchingId,
      watchingMediaType: watchingId ? watchingMediaType ?? 'movie' : null,
      watchingAction,
      watchingVersion: watchingAction ? watchingVersionRef.current : null,
      idempotencyKey: `wmatch:movie-sync:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      updatedAt: Date.now(),
    };

    pendingSyncPayloadRef.current = payload;

    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    if (watchingAction) {
      pendingSyncPayloadRef.current = null;
      void enqueueMovieSyncPayload(payload).then(() => flushMovieSyncOutbox());
      return;
    }

    syncTimeoutRef.current = setTimeout(() => {
      syncTimeoutRef.current = null;
      const payload = pendingSyncPayloadRef.current;
      pendingSyncPayloadRef.current = null;

      if (!payload) {
        return;
      }

      void enqueueMovieSyncPayload(payload).then(() => flushMovieSyncOutbox());
    }, PROFILE_SYNC_DEBOUNCE_MS);
  };

  const flushMovieSyncOutbox = async () => {
    const syncUserId = user?.id;

    if (!syncUserId) {
      return;
    }

    if (syncInFlightRef.current) {
      flushRequestedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;

    try {
      while (activeUserIdRef.current === syncUserId) {
        await outboxMutationRef.current.catch(() => undefined);
        const queue = await readMovieSyncOutbox();
        const nextPayload = queue[0];

        if (!nextPayload) {
          break;
        }

        const synced = await syncToDatabase(nextPayload, syncUserId);
        if (!synced) {
          break;
        }

        await clearMovieSyncOutbox(nextPayload.idempotencyKey);
      }
    } finally {
      syncInFlightRef.current = false;

      if (flushRequestedRef.current && activeUserIdRef.current) {
        flushRequestedRef.current = false;
        setTimeout(() => {
          void flushMovieSyncOutboxRef.current();
        }, 0);
      }
    }
  };

  flushMovieSyncOutboxRef.current = flushMovieSyncOutbox;

  const getRemainingWatchMs = (watchingUpdatedAt: string | null) => {
    if (!watchingUpdatedAt) {
      return null;
    }

    const startedAt = new Date(watchingUpdatedAt).getTime();

    if (!Number.isFinite(startedAt)) {
      return null;
    }

    return Math.max(0, startedAt + WATCH_SESSION_DURATION_MS - getServerNowMs());
  };

  useEffect(() => {
    let mounted = true;

    async function hydrateFromProfile() {
      if (!user) {
        setCurrentlyWatchingState(null);
        setActiveWatching(null);
        setCurrentlyWatchingUpdatedAt(null);
        setWatchingState('idle');
        setFavorites([]);
        setWatched([]);
        setLibraryError(null);
        setWatchingExpiredNotice(null);
        setPausedWatching(null);
        return;
      }

      setLibraryLoading(true);
      setLibraryError(null);

      try {
        const pendingOutboxPromise = readMovieSyncOutbox();
        const cachedLibrary = await readLibrarySnapshot(user.id);

        if (!mounted) {
          return;
        }

        if (cachedLibrary) {
          setFavorites(cachedLibrary.favorites);
          setWatched(cachedLibrary.watched);
          setLibraryLoading(false);
        }

        const pendingOutboxQueue = await pendingOutboxPromise;
        const pendingOutbox = pendingOutboxQueue.at(-1) ?? null;
        const favoriteMedia = pendingOutbox?.favoriteMedia ?? user.favoriteMedia ?? legacyMovieIdsToRefs(user.favoriteMovies ?? []);
        const watchedMedia = pendingOutbox?.watchedMedia ?? user.watchedMedia ?? legacyMovieIdsToRefs(user.watchedMovies ?? []);
        const watchingId = pendingOutbox ? pendingOutbox.watchingId : user.currentlyWatching;
        const watchingMediaType = pendingOutbox ? pendingOutbox.watchingMediaType : user.currentlyWatchingMediaType;
        const serverWatchingState = pendingOutbox
          ? pendingOutbox.watchingAction === 'pause'
            ? 'paused'
            : pendingOutbox.watchingId
              ? 'active'
              : null
          : user.currentlyWatchingState;
        const [favoriteMovies, watchedMovies, activeMovie, pausedMovie] = await Promise.all([
          hydrateMovies(favoriteMedia),
          hydrateMovies(watchedMedia),
          watchingId && watchingMediaType
            ? tmdbService.getMediaByRef({ id: watchingId, mediaType: watchingMediaType })
            : Promise.resolve(null),
          watchingId
            ? Promise.resolve(null)
            : readPausedWatching(),
        ]);

        if (!mounted) {
          return;
        }

        const serverPausedEntry =
          serverWatchingState === 'paused' && activeMovie
            ? {
                movie: activeMovie,
                remainingWatchMs: Math.max(
                  0,
                  user.currentlyWatchingRemainingMs ?? WATCH_SESSION_DURATION_MS,
                ),
              }
            : null;
        const restoredPausedEntry = serverPausedEntry ?? pausedMovie;
        const visibleWatchingMovie = activeMovie ?? restoredPausedEntry?.movie ?? null;
        const nextWatchedMovies = ensureMovieInList(watchedMovies, visibleWatchingMovie);

        setFavorites(favoriteMovies);
        setWatched(nextWatchedMovies);
        persistLibrarySnapshot(favoriteMovies, nextWatchedMovies);
        setCurrentlyWatchingState(visibleWatchingMovie);
        setActiveWatching(serverWatchingState === 'active' ? activeMovie : null);
        setCurrentlyWatchingUpdatedAt(
          serverWatchingState === 'active' && activeMovie
            ? (pendingOutbox ? getServerNowIsoString() : user.currentlyWatchingUpdatedAt ?? null)
            : null,
        );
        setWatchingState(serverWatchingState === 'active' && activeMovie ? 'active' : restoredPausedEntry ? 'paused' : 'idle');
        setPausedWatching(restoredPausedEntry);

        if (serverWatchingState === 'active' && activeMovie) {
          void persistPausedWatching(null);
        } else if (restoredPausedEntry) {
          void persistPausedWatching(restoredPausedEntry);
        }
      } catch (error) {
        telemetry.captureException(error, { scope: 'movie_library.hydration' });
        if (mounted) {
          setLibraryError(error instanceof Error ? error.message : UNKNOWN_LIBRARY_ERROR);
        }
      } finally {
        if (mounted) {
          setLibraryLoading(false);
        }
      }
    }

    void hydrateFromProfile();

    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    watchingVersionRef.current = user?.currentlyWatchingVersion ?? null;
  }, [user?.currentlyWatchingVersion, user?.id]);

  useEffect(() => () => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void flushMovieSyncOutbox();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void flushMovieSyncOutbox();
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeWatching || !currentlyWatchingUpdatedAt) {
      return;
    }

    const startedAt = new Date(currentlyWatchingUpdatedAt).getTime();

    if (!Number.isFinite(startedAt)) {
      return;
    }

    const expireWatchingSession = () => {
      setCurrentlyWatchingState(null);
      setActiveWatching(null);
      setCurrentlyWatchingUpdatedAt(null);
      setWatchingState('idle');
      setPausedWatching(null);
      setWatchingExpiredNotice(WATCHING_EXPIRED_NOTICE);
      void persistPausedWatching(null);
      scheduleDatabaseSync(
        moviesToRefs(favorites),
        moviesToRefs(watched),
        null,
        null,
        'stop',
      );
    };

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleExpiration = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      const remaining = startedAt + WATCH_SESSION_DURATION_MS - getServerNowMs();

      if (remaining <= 0) {
        expireWatchingSession();
        return;
      }

      timeoutId = setTimeout(expireWatchingSession, remaining);
    };

    scheduleExpiration();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        scheduleExpiration();
      }
    });

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      appStateSubscription.remove();
    };
  }, [activeWatching ? getMovieKey(activeWatching) : null, currentlyWatchingUpdatedAt, favorites, watched, user?.id]);

  const setCurrentlyWatching = (movie: Movie) => {
    const nextUpdatedAt = getServerNowIsoString();
    const nextWatched = ensureMovieInList(watched, movie);
    const movieRef = movieToMediaRef(movie);

    setCurrentlyWatchingState(movie);
    setActiveWatching(movie);
    setCurrentlyWatchingUpdatedAt(nextUpdatedAt);
    setWatchingState('active');
    setPausedWatching(null);
    setWatchingExpiredNotice(null);
    if (nextWatched !== watched) {
      setWatched(nextWatched);
      persistLibrarySnapshot(favorites, nextWatched);
    }

    void persistPausedWatching(null);
    scheduleDatabaseSync(
      moviesToRefs(favorites),
      moviesToRefs(nextWatched),
      movieRef.id,
      movieRef.mediaType,
      'start',
    );
  };

  const pauseCurrentlyWatching = () => {
    if (!currentlyWatching) {
      return;
    }

    const remainingWatchMs = Math.max(0, getRemainingWatchMs(currentlyWatchingUpdatedAt) ?? WATCH_SESSION_DURATION_MS);
    const pausedEntry = {
      movie: currentlyWatching,
      remainingWatchMs,
    };

    setActiveWatching(null);
    setCurrentlyWatchingUpdatedAt(null);
    setWatchingState('paused');
    setPausedWatching(pausedEntry);

    void persistPausedWatching(pausedEntry);
    scheduleDatabaseSync(
      moviesToRefs(favorites),
      moviesToRefs(watched),
      currentlyWatching.id,
      currentlyWatching.media_type === 'tv' ? 'tv' : 'movie',
      'pause',
    );
  };

  const resumeCurrentlyWatching = () => {
    if (!currentlyWatching) {
      return;
    }

    const remainingWatchMs =
      pausedWatching && getMovieKey(pausedWatching.movie) === getMovieKey(currentlyWatching)
        ? pausedWatching.remainingWatchMs
        : WATCH_SESSION_DURATION_MS;
    const elapsedBeforePause = Math.max(0, WATCH_SESSION_DURATION_MS - remainingWatchMs);
    const nextUpdatedAt = new Date(getServerNowMs() - elapsedBeforePause).toISOString();
    const nextWatched = ensureMovieInList(watched, currentlyWatching);

    setActiveWatching(currentlyWatching);
    setCurrentlyWatchingUpdatedAt(nextUpdatedAt);
    setWatchingState('active');
    setPausedWatching(null);
    setWatchingExpiredNotice(null);
    if (nextWatched !== watched) {
      setWatched(nextWatched);
    }

    void persistPausedWatching(null);
    const movieRef = movieToMediaRef(currentlyWatching);
    scheduleDatabaseSync(
      moviesToRefs(favorites),
      moviesToRefs(nextWatched),
      movieRef.id,
      movieRef.mediaType,
      'resume',
    );
  };

  const addToFavorites = (movie: Movie) => {
    setFavorites((current) => {
      if (current.some((item) => getMovieKey(item) === getMovieKey(movie))) {
        return current;
      }

      const next = [...current, movie];
      persistLibrarySnapshot(next, watched);
      scheduleDatabaseSync(
        moviesToRefs(next),
        moviesToRefs(watched),
        activeWatching?.id ?? null,
        activeWatching?.media_type === 'tv' ? 'tv' : activeWatching ? 'movie' : null,
      );
      return next;
    });
  };

  const removeFromFavorites = (movie: Movie | number) => {
    setFavorites((current) => {
      const next = filterMoviesByInput(current, movie);
      persistLibrarySnapshot(next, watched);
      scheduleDatabaseSync(
        moviesToRefs(next),
        moviesToRefs(watched),
        activeWatching?.id ?? null,
        activeWatching?.media_type === 'tv' ? 'tv' : activeWatching ? 'movie' : null,
      );
      return next;
    });
  };

  const addToWatched = (movie: Movie) => {
    setWatched((current) => {
      if (current.some((item) => getMovieKey(item) === getMovieKey(movie))) {
        return current;
      }

      const next = [...current, movie];
      persistLibrarySnapshot(favorites, next);
      scheduleDatabaseSync(
        moviesToRefs(favorites),
        moviesToRefs(next),
        activeWatching?.id ?? null,
        activeWatching?.media_type === 'tv' ? 'tv' : activeWatching ? 'movie' : null,
      );
      return next;
    });
  };

  const removeFromWatched = (movie: Movie | number) => {
    setWatched((current) => {
      const next = filterMoviesByInput(current, movie);
      persistLibrarySnapshot(favorites, next);
      scheduleDatabaseSync(
        moviesToRefs(favorites),
        moviesToRefs(next),
        activeWatching?.id ?? null,
        activeWatching?.media_type === 'tv' ? 'tv' : activeWatching ? 'movie' : null,
      );
      return next;
    });
  };

  const value = useMemo<AppContextType>(
    () => ({
      currentlyWatching,
      activeWatching,
      currentlyWatchingUpdatedAt,
      watchingState,
      favorites,
      watched,
      libraryLoading,
      libraryError,
      watchingExpiredNotice,
      setCurrentlyWatching,
      pauseCurrentlyWatching,
      resumeCurrentlyWatching,
      addToFavorites,
      removeFromFavorites,
      isFavorite: (movie) => hasMovieInput(favorites, movie),
      addToWatched,
      removeFromWatched,
      isWatched: (movie) => hasMovieInput(watched, movie),
      dismissWatchingExpiredNotice: () => setWatchingExpiredNotice(null),
    }),
    [
      activeWatching,
      currentlyWatching,
      currentlyWatchingUpdatedAt,
      favorites,
      libraryError,
      libraryLoading,
      pausedWatching,
      refreshUser,
      user?.id,
      watched,
      watchingExpiredNotice,
      watchingState,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useApp must be used inside AppProvider');
  }

  return context;
}
