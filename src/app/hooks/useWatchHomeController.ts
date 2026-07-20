import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocalization } from '../../context/LocalizationContext';
import {
  getMediaRefKey,
  getMovieKey,
  tmdbService,
  type Movie,
} from '../../services/tmdb';
import { telemetry } from '../../services/telemetry';
import { readWatchHomeSnapshot, updateWatchHomeSnapshot } from '../../services/watchHomeSnapshot';
import type { AppTab, AppUser, ViewerPreview } from '../../shared/types';
import useLiveNowUsers from './useLiveNowUsers';

const LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE = 6;

function getUniqueMovies(movies: Movie[]) {
  const seen = new Set<string>();

  return movies.filter((movie) => {
    const key = getMovieKey(movie);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergeUniqueMovies(current: Movie[], incoming: Movie[]) {
  return getUniqueMovies([...current, ...incoming]);
}

function scheduleIdleWork(work: () => void, timeoutMs = 1200) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const idleCallbackId = globalThis.requestIdleCallback(work, { timeout: timeoutMs });
    return () => globalThis.cancelIdleCallback(idleCallbackId);
  }

  const timeoutId = setTimeout(work, 50);
  return () => clearTimeout(timeoutId);
}

export default function useWatchHomeController(
  user: AppUser | null,
  activeTab: AppTab,
  activeWatching: Movie | null,
) {
  const { t } = useLocalization();
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [moviesPage, setMoviesPage] = useState(1);
  const [tvPage, setTvPage] = useState(1);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingTV, setLoadingTV] = useState(true);
  const [refreshingHome, setRefreshingHome] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [popularMovies, setPopularMovies] = useState<Movie[]>([]);
  const [popularTVShows, setPopularTVShows] = useState<Movie[]>([]);
  const [liveNowMovies, setLiveNowMovies] = useState<Movie[]>([]);
  const [liveNowMediaLoading, setLiveNowMediaLoading] = useState(false);
  const searchRequestSeqRef = useRef(0);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const hasHomeSnapshotRef = useRef(false);
  const homeNetworkReadyRef = useRef({ movies: false, tvShows: false });
  const {
    users: watchUsers,
    pageInfo: liveNowPageInfo,
    loading: liveNowLoading,
    error: liveNowError,
    refresh: refreshLiveNow,
    loadMore: loadMoreLiveNow,
  } = useLiveNowUsers(user?.id ?? null, activeTab === 'watch');

  useEffect(() => {
    let cancelled = false;

    void readWatchHomeSnapshot().then((snapshot) => {
      if (cancelled || !snapshot) {
        return;
      }

      hasHomeSnapshotRef.current = snapshot.movies.length > 0 || snapshot.tvShows.length > 0;
      if (!homeNetworkReadyRef.current.movies) {
        setPopularMovies(getUniqueMovies(snapshot.movies).slice(0, 12));
        setLoadingMovies(false);
      }
      if (!homeNetworkReadyRef.current.tvShows) {
        setPopularTVShows(getUniqueMovies(snapshot.tvShows).slice(0, 12));
        setLoadingTV(false);
      }
      telemetry.markStartupMilestone('watch_snapshot_ready', {
        ageMs: Date.now() - snapshot.updatedAt,
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadInitialData = useCallback(async () => {
    setHomeError(null);
    if (!hasHomeSnapshotRef.current) {
      setLoadingMovies(true);
      setLoadingTV(true);
    }

    const results = await Promise.allSettled([
      tmdbService.getPopularMovies(1)
        .then((moviesData) => {
          const movies = getUniqueMovies(moviesData.results.slice(0, 12));
          hasHomeSnapshotRef.current = true;
          homeNetworkReadyRef.current.movies = true;
          setPopularMovies(movies);
          void updateWatchHomeSnapshot({ movies });
          setMoviesPage(1);
          telemetry.markStartupMilestone('popular_movies_ready');
        })
        .finally(() => setLoadingMovies(false)),
      tmdbService.getPopularTVShows(1)
        .then((tvData) => {
          const tvShows = getUniqueMovies(tvData.results.slice(0, 12));
          hasHomeSnapshotRef.current = true;
          homeNetworkReadyRef.current.tvShows = true;
          setPopularTVShows(tvShows);
          void updateWatchHomeSnapshot({ tvShows });
          setTvPage(1);
          telemetry.markStartupMilestone('popular_tv_ready');
        })
        .finally(() => setLoadingTV(false)),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length > 0) {
      const firstFailure = failures[0].reason;
      setHomeError(firstFailure instanceof Error ? firstFailure.message : t('data.error.generic'));
      if (failures.length === results.length) {
        throw firstFailure;
      }
    }
  }, [t]);

  const refreshHome = useCallback(async () => {
    setRefreshingHome(true);
    try {
      await Promise.allSettled([loadInitialData(), refreshLiveNow({ force: true })]);
    } finally {
      setRefreshingHome(false);
    }
  }, [loadInitialData, refreshLiveNow]);

  const activeWatchingKey = useMemo(
    () => activeWatching?.id
      ? getMediaRefKey({ id: activeWatching.id, mediaType: activeWatching.media_type ?? 'movie' })
      : null,
    [activeWatching?.id, activeWatching?.media_type],
  );
  const activeWatchingRefs = useMemo(() => {
    const refs: Array<{ id: number; mediaType?: 'movie' | 'tv' | null }> = [];
    if (activeWatching?.id) {
      refs.push({ id: activeWatching.id, mediaType: activeWatching.media_type ?? 'movie' });
    }
    watchUsers.forEach((item) => {
      if (item.currentlyWatching) {
        refs.push({
          id: item.currentlyWatching,
          mediaType: item.currentlyWatchingMediaType ?? 'movie',
        });
      }
    });
    return refs;
  }, [activeWatching?.id, activeWatching?.media_type, watchUsers]);
  const viewerCounts = useMemo(
    () => activeWatchingRefs.reduce<Record<string, number>>((counts, ref) => {
      const key = getMediaRefKey(ref);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    [activeWatchingRefs],
  );
  const viewerProfiles = useMemo(() => {
    const profilesByMovie: Record<string, ViewerPreview[]> = {};
    const addViewer = (
      ref: { id: number; mediaType?: 'movie' | 'tv' | null },
      profile: { id: string; name: string; photos: string[] },
    ) => {
      const key = getMediaRefKey(ref);
      const nextViewer: ViewerPreview = {
        id: profile.id,
        name: profile.name,
        photo: profile.photos.find((photo) => photo.trim().length > 0) ?? null,
      };
      const currentViewers = profilesByMovie[key] ?? [];
      if (!currentViewers.some((viewer) => viewer.id === nextViewer.id)) {
        profilesByMovie[key] = [...currentViewers, nextViewer];
      }
    };

    if (user && activeWatching?.id) {
      addViewer({ id: activeWatching.id, mediaType: activeWatching.media_type ?? 'movie' }, user);
    }
    watchUsers.forEach((item) => {
      if (item.currentlyWatching) {
        addViewer(
          { id: item.currentlyWatching, mediaType: item.currentlyWatchingMediaType ?? 'movie' },
          item,
        );
      }
    });
    return profilesByMovie;
  }, [activeWatching?.id, activeWatching?.media_type, user, watchUsers]);

  useEffect(() => {
    if (user?.id && activeTab === 'watch' && activeWatchingKey) {
      void refreshLiveNow({ force: true });
    }
  }, [activeTab, activeWatchingKey, refreshLiveNow, user?.id]);

  useEffect(() => {
    if (user) {
      void loadInitialData().catch((error) => {
        telemetry.captureException(error, { operation: 'watch_initial_media' });
      });
    }
  }, [loadInitialData, user?.id]);

  useEffect(() => scheduleIdleWork(() => {
    void tmdbService.prefetchMovieArtwork(
      [...popularMovies, ...popularTVShows].slice(0, 6),
      { posterSize: 'w200', priority: 'idle' },
    );
  }), [popularMovies, popularTVShows]);

  useEffect(() => {
    if (liveNowMovies.length === 0) {
      return;
    }
    return scheduleIdleWork(() => {
      void tmdbService.prefetchMovieArtwork(liveNowMovies.slice(0, 4), {
        posterSize: 'w200',
        priority: 'predictive',
      });
    });
  }, [liveNowMovies]);

  useEffect(() => {
    if (searchResults.length === 0) {
      return;
    }
    return scheduleIdleWork(() => {
      void tmdbService.prefetchMovieArtwork(searchResults.slice(0, 6), {
        posterSize: 'w200',
        priority: 'predictive',
      });
    });
  }, [searchResults]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateLiveNowMovies() {
      const seenRefs = new Set<string>();
      const uniqueRefs = activeWatchingRefs.filter((ref) => {
        const key = getMediaRefKey(ref);
        if (seenRefs.has(key)) {
          return false;
        }
        seenRefs.add(key);
        return true;
      });

      if (uniqueRefs.length === 0) {
        setLiveNowMovies([]);
        setLiveNowMediaLoading(false);
        return;
      }

      const lookup = new Map<string, Movie>();
      [...popularMovies, ...popularTVShows].forEach((movie) => lookup.set(getMovieKey(movie), movie));
      const missingRefs = uniqueRefs.filter((ref) => !lookup.has(getMediaRefKey(ref)));
      const commit = () => {
        if (!cancelled) {
          setLiveNowMovies(
            uniqueRefs
              .map((ref) => lookup.get(getMediaRefKey(ref)))
              .filter((movie): movie is Movie => movie != null),
          );
        }
      };

      commit();
      if (missingRefs.length > 0) {
        setLiveNowMediaLoading(true);
        for (let index = 0; index < missingRefs.length; index += LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE) {
          try {
            const movies = await tmdbService.getMediaListByRefs(
              missingRefs.slice(index, index + LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE),
            );
            movies.forEach((movie) => lookup.set(getMovieKey(movie), movie));
            commit();
          } catch (error) {
            telemetry.captureException(error, { operation: 'live_now_media_batch' });
          }
        }
      }

      if (!cancelled) {
        commit();
        setLiveNowMediaLoading(false);
      }
    }

    void hydrateLiveNowMovies();
    return () => {
      cancelled = true;
    };
  }, [activeWatchingRefs, popularMovies, popularTVShows]);

  const loadMoreMovies = useCallback(async () => {
    if (loadingMovies) {
      return;
    }
    setLoadingMovies(true);
    try {
      const nextPage = moviesPage + 1;
      const data = await tmdbService.getPopularMovies(nextPage);
      setPopularMovies((current) => mergeUniqueMovies(current, data.results.slice(0, 12)));
      setMoviesPage(nextPage);
      setHomeError(null);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t('data.error.generic'));
    } finally {
      setLoadingMovies(false);
    }
  }, [loadingMovies, moviesPage, t]);

  const loadMoreTVShows = useCallback(async () => {
    if (loadingTV) {
      return;
    }
    setLoadingTV(true);
    try {
      const nextPage = tvPage + 1;
      const data = await tmdbService.getPopularTVShows(nextPage);
      setPopularTVShows((current) => mergeUniqueMovies(current, data.results.slice(0, 12)));
      setTvPage(nextPage);
      setHomeError(null);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t('data.error.generic'));
    } finally {
      setLoadingTV(false);
    }
  }, [loadingTV, t, tvPage]);

  const handleSearch = useCallback(async (query: string, filter: 'all' | 'movie' | 'tv') => {
    searchAbortControllerRef.current?.abort();
    searchAbortControllerRef.current = null;
    const requestSeq = ++searchRequestSeqRef.current;
    const normalizedQuery = query.trim();
    setSearchQuery(normalizedQuery);
    setIsSearching(Boolean(normalizedQuery));
    setSearchError(null);

    if (!normalizedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      setIsSearching(false);
      return;
    }

    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;
    setSearchLoading(true);
    try {
      const response = filter === 'movie'
        ? await tmdbService.searchMovies(normalizedQuery, 1, abortController.signal)
        : filter === 'tv'
          ? await tmdbService.searchTVShows(normalizedQuery, 1, abortController.signal)
          : await tmdbService.searchMulti(normalizedQuery, 1, abortController.signal);
      if (searchRequestSeqRef.current === requestSeq) {
        setSearchResults(getUniqueMovies(response.results.slice(0, 12)));
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError') && searchRequestSeqRef.current === requestSeq) {
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : t('data.error.generic'));
      }
    } finally {
      if (searchRequestSeqRef.current === requestSeq) {
        setSearchLoading(false);
      }
      if (searchAbortControllerRef.current === abortController) {
        searchAbortControllerRef.current = null;
      }
    }
  }, [t]);

  useEffect(() => () => searchAbortControllerRef.current?.abort(), []);

  return {
    isSearching,
    searchQuery,
    searchResults,
    loadingMovies,
    loadingTV,
    refreshingHome,
    homeError,
    searchLoading,
    searchError,
    popularMovies,
    popularTVShows,
    liveNowMovies,
    liveNowLoading: liveNowLoading || liveNowMediaLoading,
    liveNowError,
    viewerCounts,
    viewerProfiles,
    canLoadMoreLiveNow: liveNowPageInfo.hasMore,
    refreshLiveNow,
    refreshHome,
    loadMoreLiveNow,
    loadMoreMovies,
    loadMoreTVShows,
    handleSearch,
    setIsSearching,
  };
}
