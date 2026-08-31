import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { API_BASE, fetchWithRetry, getAuthHeaders } from '../../utils/supabase/client';
import {
  getMovieKey,
  legacyMovieIdsToRefs,
  movieToMediaRef,
  tmdbService,
  type Movie,
} from '../services/tmdb';
import type { MediaRef, MediaType } from '../shared/types';
import { storageKeys } from '../shared/constants/storage';
import { getServerNowIsoString, getServerNowMs, syncServerTimeFromHeaders } from '../shared/utils/serverTime';
import { subscribeToForeground } from '../shared/utils/appLifecycle';
import { telemetry } from '../services/telemetry';
import { useAuth } from './AuthContext';
import {
  deleteLibrarySnapshot,
  ensureMovieInList,
  filterMoviesByInput,
  hasMovieInput,
  isMovieSyncPayloadDeliverable,
  markMovieSyncPayloadFailure,
  moviesToRefs,
  readLibrarySnapshot,
  readMovieSyncOutbox as readStoredMovieSyncOutbox,
  readPausedWatching as readStoredPausedWatching,
  resetMovieSyncPayloadDelivery,
  writeLibrarySnapshot,
  writeMovieSyncOutbox as writeStoredMovieSyncOutbox,
  writePausedWatching,
  type MovieSyncPayload,
  type PausedWatchingEntry,
} from './app/librarySupport';

interface WatchSessionContextType {
  currentlyWatching: Movie | null;
  activeWatching: Movie | null;
  currentlyWatchingUpdatedAt: string | null;
  watchingState: 'idle' | 'active' | 'paused';
  watchingExpiredNotice: string | null;
  setCurrentlyWatching: (movie: Movie) => void;
  pauseCurrentlyWatching: () => void;
  resumeCurrentlyWatching: () => void;
  dismissWatchingExpiredNotice: () => void;
}

interface LibraryContextType {
  favorites: Movie[];
  watched: Movie[];
  libraryLoading: boolean;
  libraryError: string | null;
  addToFavorites: (movie: Movie) => void;
  removeFromFavorites: (movie: Movie | number) => void;
  isFavorite: (movie: Movie | number) => boolean;
  addToWatched: (movie: Movie) => void;
  removeFromWatched: (movie: Movie | number) => void;
  isWatched: (movie: Movie | number) => boolean;
}

type AppContextType = WatchSessionContextType & LibraryContextType;

const WatchSessionContext = createContext<WatchSessionContextType | undefined>(undefined);
const LibraryContext = createContext<LibraryContextType | undefined>(undefined);
const WATCH_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const PROFILE_SYNC_DEBOUNCE_MS = 400;
const MOVIE_HYDRATION_BATCH_SIZE = 8;
const UNKNOWN_LIBRARY_ERROR = 'data.error.generic';
const WATCHING_EXPIRED_NOTICE =
  'Bir içerik en fazla 12 saat boyunca "Şu anda izleniyor" alanında kalabilir. Süre dolduğu için otomatik olarak durduruldu.';

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
  const syncRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSyncPayloadRef = useRef<MovieSyncPayload | null>(null);
  const outboxMutationRef = useRef<Promise<unknown>>(Promise.resolve());
  const syncInFlightRef = useRef(false);
  const flushRequestedRef = useRef(false);
  const activeUserIdRef = useRef<string | null>(user?.id ?? null);
  const flushMovieSyncOutboxRef = useRef<() => Promise<void>>(async () => undefined);
  const watchingVersionRef = useRef<number | null>(user?.currentlyWatchingVersion ?? null);
  const libraryCacheMutationRef = useRef<Promise<void>>(Promise.resolve());
  const libraryUserRef = useRef(user);

  libraryUserRef.current = user;

  activeUserIdRef.current = user?.id ?? null;

  // Only library/watch fields can invalidate this hydration. Profile photos, display
  // names and other account refreshes must not refetch the entire movie library.
  const libraryHydrationKey = useMemo(
    () => user
      ? JSON.stringify({
          id: user.id,
          favoriteMedia: user.favoriteMedia,
          watchedMedia: user.watchedMedia,
          favoriteMovies: user.favoriteMovies,
          watchedMovies: user.watchedMovies,
          currentlyWatching: user.currentlyWatching,
          currentlyWatchingMediaType: user.currentlyWatchingMediaType,
          currentlyWatchingState: user.currentlyWatchingState,
          currentlyWatchingRemainingMs: user.currentlyWatchingRemainingMs,
          currentlyWatchingUpdatedAt: user.currentlyWatchingUpdatedAt,
        })
      : 'signed-out',
    [user],
  );

  const pausedWatchingStorageKey = user ? storageKeys.pausedWatching(user.id) : null;
  const movieSyncOutboxKey = user ? storageKeys.movieSyncOutbox(user.id) : null;

  const persistLibrarySnapshot = (nextFavorites: Movie[], nextWatched: Movie[]) => {
    const userId = activeUserIdRef.current;
    if (!userId) {
      return;
    }

    libraryCacheMutationRef.current = libraryCacheMutationRef.current
      .catch(() => undefined)
      .then(async () => {
        if (activeUserIdRef.current !== userId) {
          return;
        }

        await writeLibrarySnapshot(userId, nextFavorites, nextWatched);

        if (activeUserIdRef.current !== userId) {
          await deleteLibrarySnapshot(userId);
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

  const readPausedWatching = () => (
    readStoredPausedWatching(pausedWatchingStorageKey, WATCH_SESSION_DURATION_MS)
  );
  const persistPausedWatching = (entry: PausedWatchingEntry | null) => (
    writePausedWatching(pausedWatchingStorageKey, entry)
  );
  const readMovieSyncOutbox = () => readStoredMovieSyncOutbox(movieSyncOutboxKey);
  const writeMovieSyncOutbox = async (queue: MovieSyncPayload[]) => {
    try {
      await writeStoredMovieSyncOutbox(movieSyncOutboxKey, queue);
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
      const pendingPayload = resetMovieSyncPayloadDelivery(payload);
      if (payload.watchingAction) {
        return [...queue, pendingPayload];
      }

      return [...queue.filter((entry) => Boolean(entry.watchingAction)), pendingPayload];
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

      const requestBody: Record<string, unknown> = {
        favoriteMovies: payload.favoriteMedia.map((item) => item.id),
        favoriteMedia: payload.favoriteMedia,
        watchedMovies: payload.watchedMedia.map((item) => item.id),
        watchedMedia: payload.watchedMedia,
      };

      if (payload.watchingAction) {
        requestBody.currentlyWatching = payload.watchingId;
        requestBody.currentlyWatchingMediaType = payload.watchingMediaType;
        requestBody.currentlyWatchingAction = payload.watchingAction;
        requestBody.currentlyWatchingVersion = watchingVersionRef.current;
      }

      const response = await fetchWithRetry(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Idempotency-Key': payload.idempotencyKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (activeUserIdRef.current !== expectedUserId) {
        return false;
      }

      syncServerTimeFromHeaders(response.headers);
      const responsePayload = await response.json().catch(() => ({})) as {
        profile?: { currentlyWatchingVersion?: number | null };
        conflict?: Record<string, unknown> & { version?: number | null };
        error?: unknown;
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

        const responseError =
          typeof responsePayload.error === 'string' && responsePayload.error.trim()
            ? responsePayload.error.trim()
            : null;
        throw new Error(
          responseError
            ? `Movie sync failed with status ${response.status}: ${responseError}`
            : `Movie sync failed with status ${response.status}`,
        );
      }

      const nextWatchingVersion = responsePayload.profile?.currentlyWatchingVersion;
      if (typeof nextWatchingVersion === 'number') {
        watchingVersionRef.current = nextWatchingVersion;
      } else if (payload.watchingAction === 'stop') {
        watchingVersionRef.current = null;
      }

      return true;
    } catch (error) {
      telemetry.captureException(error, { scope: 'movie_sync' });
      console.warn('Movie sync retry scheduled:', error);
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
        const nextPayload = queue.find((entry) => (entry.deliveryStatus ?? 'pending') === 'pending');

        if (!nextPayload) {
          break;
        }

        if (!isMovieSyncPayloadDeliverable(nextPayload)) {
          if (nextPayload.nextAttemptAt != null) {
            if (syncRetryTimeoutRef.current) {
              clearTimeout(syncRetryTimeoutRef.current);
            }
            syncRetryTimeoutRef.current = setTimeout(() => {
              syncRetryTimeoutRef.current = null;
              void flushMovieSyncOutboxRef.current();
            }, Math.max(0, nextPayload.nextAttemptAt - Date.now()));
          }
          break;
        }

        const synced = await syncToDatabase(nextPayload, syncUserId);
        if (!synced) {
          const failedPayload = markMovieSyncPayloadFailure(nextPayload);
          await mutateMovieSyncOutbox((currentQueue) => currentQueue.map((entry) => (
            entry.idempotencyKey === failedPayload.idempotencyKey ? failedPayload : entry
          )));

          if (failedPayload.deliveryStatus === 'pending' && failedPayload.nextAttemptAt != null) {
            if (syncRetryTimeoutRef.current) {
              clearTimeout(syncRetryTimeoutRef.current);
            }
            syncRetryTimeoutRef.current = setTimeout(() => {
              syncRetryTimeoutRef.current = null;
              void flushMovieSyncOutboxRef.current();
            }, Math.max(0, failedPayload.nextAttemptAt - Date.now()));
          }
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
      const hydrationUser = libraryUserRef.current;

      if (!hydrationUser) {
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
        const cachedLibrary = await readLibrarySnapshot(hydrationUser.id);

        if (!mounted) {
          return;
        }

        if (cachedLibrary) {
          setFavorites(cachedLibrary.favorites);
          setWatched(cachedLibrary.watched);
          setLibraryLoading(false);
        }

        const pendingOutboxQueue = await pendingOutboxPromise;
        const pendingOutbox = pendingOutboxQueue
          .filter((entry) => (entry.deliveryStatus ?? 'pending') === 'pending')
          .at(-1) ?? null;
        const favoriteMedia = pendingOutbox?.favoriteMedia ?? hydrationUser.favoriteMedia ?? legacyMovieIdsToRefs(hydrationUser.favoriteMovies ?? []);
        const watchedMedia = pendingOutbox?.watchedMedia ?? hydrationUser.watchedMedia ?? legacyMovieIdsToRefs(hydrationUser.watchedMovies ?? []);
        const watchingId = pendingOutbox ? pendingOutbox.watchingId : hydrationUser.currentlyWatching;
        const watchingMediaType = pendingOutbox ? pendingOutbox.watchingMediaType : hydrationUser.currentlyWatchingMediaType;
        const serverWatchingState = pendingOutbox
          ? pendingOutbox.watchingAction === 'pause'
            ? 'paused'
            : pendingOutbox.watchingId
              ? 'active'
              : null
          : hydrationUser.currentlyWatchingState;
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
                  hydrationUser.currentlyWatchingRemainingMs ?? WATCH_SESSION_DURATION_MS,
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
            ? (pendingOutbox ? getServerNowIsoString() : hydrationUser.currentlyWatchingUpdatedAt ?? null)
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
  }, [libraryHydrationKey]);

  useEffect(() => {
    watchingVersionRef.current = user?.currentlyWatchingVersion ?? null;
  }, [user?.currentlyWatchingVersion, user?.id]);

  useEffect(() => () => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    if (syncRetryTimeoutRef.current) {
      clearTimeout(syncRetryTimeoutRef.current);
      syncRetryTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void flushMovieSyncOutbox();

    const unsubscribeForeground = subscribeToForeground(() => void flushMovieSyncOutbox());

    return unsubscribeForeground;
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

    const unsubscribeForeground = subscribeToForeground(scheduleExpiration);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      unsubscribeForeground();
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

      const next = [movie, ...current];
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

      const next = [movie, ...current];
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

  const watchSessionValue = useMemo<WatchSessionContextType>(
    () => ({
      currentlyWatching,
      activeWatching,
      currentlyWatchingUpdatedAt,
      watchingState,
      watchingExpiredNotice,
      setCurrentlyWatching,
      pauseCurrentlyWatching,
      resumeCurrentlyWatching,
      dismissWatchingExpiredNotice: () => setWatchingExpiredNotice(null),
    }),
    [
      activeWatching,
      currentlyWatching,
      currentlyWatchingUpdatedAt,
      favorites,
      pausedWatching,
      refreshUser,
      user?.id,
      watched,
      watchingExpiredNotice,
      watchingState,
    ],
  );
  const libraryValue = useMemo<LibraryContextType>(
    () => ({
      favorites,
      watched,
      libraryLoading,
      libraryError,
      addToFavorites,
      removeFromFavorites,
      isFavorite: (movie) => hasMovieInput(favorites, movie),
      addToWatched,
      removeFromWatched,
      isWatched: (movie) => hasMovieInput(watched, movie),
    }),
    [
      activeWatching,
      favorites,
      libraryError,
      libraryLoading,
      user?.id,
      watched,
    ],
  );

  return (
    <WatchSessionContext.Provider value={watchSessionValue}>
      <LibraryContext.Provider value={libraryValue}>{children}</LibraryContext.Provider>
    </WatchSessionContext.Provider>
  );
}

export function useWatchSession() {
  const context = useContext(WatchSessionContext);

  if (!context) {
    throw new Error('useWatchSession must be used inside AppProvider');
  }

  return context;
}

export function useLibrary() {
  const context = useContext(LibraryContext);

  if (!context) {
    throw new Error('useLibrary must be used inside AppProvider');
  }

  return context;
}

export function useApp(): AppContextType {
  return { ...useWatchSession(), ...useLibrary() };
}
