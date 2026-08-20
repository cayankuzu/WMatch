import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiRequestError,
  getCompatibilityDiscoveryEntries,
  getLikesDiscovery,
  getWatchDiscoveryUsers,
  type ApiUser,
} from '../../services/api';
import type { CompatibilityDiscoveryEntry } from '../../shared/types';
import { BoundedMap } from '../../shared/utils/boundedMap';
import { registerSessionCache } from '../../shared/utils/sessionCache';
import { subscribeToForeground } from '../../shared/utils/appLifecycle';
import { isOffline, subscribeToConnectivity } from '../../services/connectivity';
import { subscribeToUserEvent } from '../../services/userEventBus';

const REALTIME_DEBOUNCE_MS = 500;
const DISCOVERY_CACHE_TTL_MS = 300_000;
const DISCOVERY_REVALIDATE_AFTER_MS = 30_000;
const LIKES_SLICE_CACHE_TTL_MS = 45_000;

export type DiscoveryMode = 'watch' | 'compatibility' | 'likes';
type DiscoveryStatus = 'idle' | 'loading' | 'success' | 'stale' | 'error';

interface DiscoveryDataState {
  watchUsers: ApiUser[];
  compatibilityEntries: CompatibilityDiscoveryEntry[];
  likedUsers: ApiUser[];
  likedByUsers: ApiUser[];
  likedByUserIds: string[];
  likedByCount: number;
  likedByLocked: boolean;
}

const emptyDiscoveryState = (): DiscoveryDataState => ({
  watchUsers: [],
  compatibilityEntries: [],
  likedUsers: [],
  likedByUsers: [],
  likedByUserIds: [],
  likedByCount: 0,
  likedByLocked: true,
});

interface DiscoveryPageInfo {
  hasMore: boolean;
  nextCursor: string | null;
}

interface DiscoverySnapshot {
  state: DiscoveryDataState;
  pageInfo: DiscoveryPageInfo;
  updatedAt: number;
}

interface DiscoveryCacheEntry extends DiscoverySnapshot {
  expiresAt: number;
}

const EMPTY_PAGE_INFO: DiscoveryPageInfo = { hasMore: false, nextCursor: null };
const discoveryCache = new BoundedMap<string, DiscoveryCacheEntry>(24);
const discoveryLoadFlights = new BoundedMap<string, Promise<DiscoverySnapshot>>(24);
type LikesDiscoveryData = Awaited<ReturnType<typeof getLikesDiscovery>>;
const likesSliceCache = new BoundedMap<string, { value: LikesDiscoveryData; expiresAt: number }>(4);
const likesSliceFlights = new BoundedMap<string, Promise<LikesDiscoveryData>>(4);
let discoveryCacheGeneration = 0;
registerSessionCache(() => {
  discoveryCacheGeneration += 1;
  discoveryCache.clear();
  discoveryLoadFlights.clear();
  likesSliceCache.clear();
  likesSliceFlights.clear();
});

function getDiscoveryCacheKey(mode: DiscoveryMode, userId?: string | null) {
  return userId ? `${userId}:${mode}` : null;
}

function cloneDiscoveryState(state: DiscoveryDataState): DiscoveryDataState {
  return {
    watchUsers: [...state.watchUsers],
    compatibilityEntries: [...state.compatibilityEntries],
    likedUsers: [...state.likedUsers],
    likedByUsers: [...state.likedByUsers],
    likedByUserIds: [...state.likedByUserIds],
    likedByCount: state.likedByCount,
    likedByLocked: state.likedByLocked,
  };
}

function cloneDiscoverySnapshot(snapshot: DiscoverySnapshot): DiscoverySnapshot {
  return {
    state: cloneDiscoveryState(snapshot.state),
    pageInfo: { ...snapshot.pageInfo },
    updatedAt: snapshot.updatedAt,
  };
}

function getCachedDiscoverySnapshot(mode: DiscoveryMode, userId?: string | null) {
  const cacheKey = getDiscoveryCacheKey(mode, userId);

  if (!cacheKey) {
    return null;
  }

  const cached = discoveryCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }

  return cloneDiscoverySnapshot(cached);
}

function cacheDiscoverySnapshot(cacheKey: string, snapshot: DiscoverySnapshot) {
  discoveryCache.set(cacheKey, {
    ...cloneDiscoverySnapshot(snapshot),
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
  });
}

function isDiscoverySnapshotFresh(snapshot: DiscoverySnapshot | null) {
  return Boolean(snapshot && Date.now() - snapshot.updatedAt < DISCOVERY_REVALIDATE_AFTER_MS);
}

async function preloadLikesSlice(userId: string, force: boolean) {
  const cached = likesSliceCache.get(userId);

  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const existingFlight = likesSliceFlights.get(userId);
  if (existingFlight) {
    return existingFlight;
  }

  const requestGeneration = discoveryCacheGeneration;
  const flight = getLikesDiscovery(force)
    .then((value) => {
      if (requestGeneration === discoveryCacheGeneration) {
        likesSliceCache.set(userId, {
          value,
          expiresAt: Date.now() + LIKES_SLICE_CACHE_TTL_MS,
        });
      }

      return value;
    })
    .finally(() => {
      if (likesSliceFlights.get(userId) === flight) {
        likesSliceFlights.delete(userId);
      }
    });

  likesSliceFlights.set(userId, flight);
  return flight;
}

export async function preloadDiscoveryData(
  mode: DiscoveryMode,
  userId: string,
  force = false,
): Promise<DiscoverySnapshot> {
  const cacheKey = getDiscoveryCacheKey(mode, userId);
  if (!cacheKey) {
    return {
      state: emptyDiscoveryState(),
      pageInfo: EMPTY_PAGE_INFO,
      updatedAt: Date.now(),
    };
  }

  const cached = getCachedDiscoverySnapshot(mode, userId);
  if (!force && cached) {
    return cached;
  }

  const existingFlight = discoveryLoadFlights.get(cacheKey);
  if (existingFlight) {
    return existingFlight;
  }

  const requestGeneration = discoveryCacheGeneration;
  const flight = (async () => {
    const currentState = cached?.state ?? emptyDiscoveryState();
    let state: DiscoveryDataState;
    let pageInfo = EMPTY_PAGE_INFO;

    if (mode === 'watch') {
      const [watchResponse, likesDiscovery] = await Promise.all([
        getWatchDiscoveryUsers({ force }),
        preloadLikesSlice(userId, force),
      ]);
      pageInfo = watchResponse.pageInfo;
      state = {
        ...currentState,
        watchUsers: watchResponse.users,
        likedUsers: likesDiscovery.likedUsers,
        likedByUsers: likesDiscovery.likedByUsers,
        likedByUserIds: likesDiscovery.likedByUserIds,
        likedByCount: likesDiscovery.likedByCount,
        likedByLocked: likesDiscovery.likedByLocked,
      };
    } else if (mode === 'compatibility') {
      const [compatibilityResponse, likesDiscovery] = await Promise.all([
        getCompatibilityDiscoveryEntries({ force }),
        preloadLikesSlice(userId, force),
      ]);
      pageInfo = compatibilityResponse.pageInfo;
      state = {
        ...currentState,
        compatibilityEntries: compatibilityResponse.entries,
        likedUsers: likesDiscovery.likedUsers,
        likedByUsers: likesDiscovery.likedByUsers,
        likedByUserIds: likesDiscovery.likedByUserIds,
        likedByCount: likesDiscovery.likedByCount,
        likedByLocked: likesDiscovery.likedByLocked,
      };
    } else {
      const likesDiscovery = await preloadLikesSlice(userId, force);
      state = {
        ...currentState,
        likedUsers: likesDiscovery.likedUsers,
        likedByUsers: likesDiscovery.likedByUsers,
        likedByUserIds: likesDiscovery.likedByUserIds,
        likedByCount: likesDiscovery.likedByCount,
        likedByLocked: likesDiscovery.likedByLocked,
      };
    }

    const snapshot = { state, pageInfo, updatedAt: Date.now() };
    if (requestGeneration === discoveryCacheGeneration) {
      cacheDiscoverySnapshot(cacheKey, snapshot);
    }
    return cloneDiscoverySnapshot(snapshot);
  })().finally(() => {
    if (discoveryLoadFlights.get(cacheKey) === flight) {
      discoveryLoadFlights.delete(cacheKey);
    }
  });

  discoveryLoadFlights.set(cacheKey, flight);
  return flight;
}

function hasModeData(state: DiscoveryDataState, mode: DiscoveryMode) {
  if (mode === 'watch') {
    return state.watchUsers.length > 0 || state.likedUsers.length > 0 || state.likedByUsers.length > 0;
  }

  if (mode === 'compatibility') {
    return state.compatibilityEntries.length > 0 || state.likedUsers.length > 0 || state.likedByUsers.length > 0;
  }

  return state.likedUsers.length > 0 || state.likedByUsers.length > 0;
}

function normalizeDiscoveryError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error;
  }

  return new ApiRequestError({
    message: error instanceof Error ? error.message : 'Discovery data could not be loaded',
    code: 'CONTRACT_VIOLATION',
    retryable: true,
    userMessageKey: 'data.error.generic',
    cause: error,
  });
}

interface LoadOptions {
  showLoading?: boolean;
  showRefreshing?: boolean;
  force?: boolean;
}

export default function useDiscoveryData(mode: DiscoveryMode, currentUserId?: string | null) {
  const [state, setState] = useState<DiscoveryDataState>(() =>
    getCachedDiscoverySnapshot(mode, currentUserId)?.state ?? emptyDiscoveryState(),
  );
  const [loading, setLoading] = useState(() => Boolean(currentUserId && !getCachedDiscoverySnapshot(mode, currentUserId)));
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<DiscoveryStatus>(() =>
    currentUserId && getCachedDiscoverySnapshot(mode, currentUserId) ? 'success' : 'idle',
  );
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(() =>
    getCachedDiscoverySnapshot(mode, currentUserId)?.updatedAt ?? null,
  );
  const [discoveryPageInfo, setDiscoveryPageInfo] = useState<DiscoveryPageInfo>(() =>
    getCachedDiscoverySnapshot(mode, currentUserId)?.pageInfo ?? EMPTY_PAGE_INFO,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const loadMoreInFlightRef = useRef<Promise<void> | null>(null);
  const loadSequenceRef = useRef(0);
  const activeScopeRef = useRef(`${currentUserId ?? 'anonymous'}:${mode}`);
  const suppressedUserIdsRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(state);

  activeScopeRef.current = `${currentUserId ?? 'anonymous'}:${mode}`;

  const applySuppressedUsers = useCallback((nextState: DiscoveryDataState) => {
    const suppressedUserIds = suppressedUserIdsRef.current;

    if (suppressedUserIds.size === 0) {
      return nextState;
    }

    return {
      watchUsers: nextState.watchUsers.filter((user) => !suppressedUserIds.has(user.id)),
      compatibilityEntries: nextState.compatibilityEntries.filter((entry) => !suppressedUserIds.has(entry.user.id)),
      likedUsers: nextState.likedUsers.filter((user) => !suppressedUserIds.has(user.id)),
      likedByUsers: nextState.likedByUsers.filter((user) => !suppressedUserIds.has(user.id)),
      likedByUserIds: nextState.likedByUserIds.filter((userId) => !suppressedUserIds.has(userId)),
      likedByCount: Math.max(
        0,
        nextState.likedByCount -
          nextState.likedByUserIds.filter((userId) => suppressedUserIds.has(userId)).length,
      ),
      likedByLocked: nextState.likedByLocked,
    };
  }, []);

  const suppressUser = useCallback((userId: string) => {
    if (!userId) {
      return;
    }

    suppressedUserIdsRef.current.add(userId);
    setState((current) => {
      const nextState = applySuppressedUsers({
        watchUsers: current.watchUsers,
        compatibilityEntries: current.compatibilityEntries,
        likedUsers: current.likedUsers,
        likedByUsers: current.likedByUsers,
        likedByUserIds: current.likedByUserIds,
        likedByCount: current.likedByCount,
        likedByLocked: current.likedByLocked,
      });
      const cacheKey = getDiscoveryCacheKey(mode, currentUserId);

      if (cacheKey) {
        const cachedSnapshot = getCachedDiscoverySnapshot(mode, currentUserId);
        cacheDiscoverySnapshot(cacheKey, {
          state: nextState,
          pageInfo: cachedSnapshot?.pageInfo ?? EMPTY_PAGE_INFO,
          updatedAt: Date.now(),
        });
      }

      stateRef.current = nextState;
      return nextState;
    });
  }, [applySuppressedUsers, currentUserId, mode]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadData = useCallback(
    async (options?: LoadOptions) => {
      const currentFlight = loadInFlightRef.current;

      if (currentFlight) {
        if (options?.showRefreshing) {
          setRefreshing(true);
        }

        try {
          await currentFlight;
        } finally {
          if (options?.showRefreshing) {
            setRefreshing(false);
          }
        }

        if (!options?.force) {
          return;
        }

        if (loadInFlightRef.current && loadInFlightRef.current !== currentFlight) {
          return;
        }
      }

      if (!currentUserId) {
        loadInFlightRef.current = null;
        suppressedUserIdsRef.current = new Set();
        setState({
          watchUsers: [],
          compatibilityEntries: [],
          likedUsers: [],
          likedByUsers: [],
          likedByUserIds: [],
          likedByCount: 0,
          likedByLocked: true,
        });
        setStatus('idle');
        setError(null);
        setUpdatedAt(null);
        setDiscoveryPageInfo({ hasMore: false, nextCursor: null });
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        return;
      }

      const requestScope = `${currentUserId}:${mode}`;
      const requestSequence = ++loadSequenceRef.current;
      const isCurrentRequest = () =>
        activeScopeRef.current === requestScope && loadSequenceRef.current === requestSequence;
      const request = (async () => {
        if (options?.showLoading) {
          setLoading(true);
          setStatus('loading');
        }

        if (options?.showRefreshing) {
          setRefreshing(true);
        }

        try {
          const snapshot = await preloadDiscoveryData(mode, currentUserId, options?.force);

          if (!isCurrentRequest()) {
            return;
          }

          const nextState = applySuppressedUsers(snapshot.state);
          stateRef.current = nextState;
          setState(nextState);
          setDiscoveryPageInfo(snapshot.pageInfo);
          setError(null);
          setStatus('success');
          setUpdatedAt(snapshot.updatedAt);
        } catch (caughtError) {
          if (!isCurrentRequest()) {
            return;
          }

          const nextError = normalizeDiscoveryError(caughtError);
          const hasData = hasModeData(stateRef.current, mode);

          setError(nextError);
          setStatus(hasData ? 'stale' : 'error');
          console.warn('Discovery data load failed', {
            mode,
            code: nextError.code,
            status: nextError.status,
            requestId: nextError.requestId,
          });
        } finally {
          if (isCurrentRequest()) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      })();

      loadInFlightRef.current = request;

      try {
        await request;
      } finally {
        if (loadInFlightRef.current === request) {
          loadInFlightRef.current = null;
        }
      }
    },
    [applySuppressedUsers, currentUserId, mode],
  );

  const loadMore = useCallback(async () => {
    if (
      (mode !== 'compatibility' && mode !== 'watch') ||
      !currentUserId ||
      !discoveryPageInfo.hasMore ||
      !discoveryPageInfo.nextCursor ||
      loadInFlightRef.current
    ) {
      return;
    }

    if (loadMoreInFlightRef.current) {
      return loadMoreInFlightRef.current;
    }

    const requestScope = `${currentUserId}:${mode}`;
    const cursor = discoveryPageInfo.nextCursor;
    const request = (async () => {
      setLoadingMore(true);

      try {
        let nextState: DiscoveryDataState;
        let nextPageInfo: { hasMore: boolean; nextCursor: string | null };

        if (mode === 'watch') {
          const response = await getWatchDiscoveryUsers({ cursor });
          nextPageInfo = response.pageInfo;
          nextState = applySuppressedUsers({
            ...stateRef.current,
            watchUsers: [...new Map(
              [...stateRef.current.watchUsers, ...response.users]
                .map((user) => [user.id, user] as const),
            ).values()],
          });
        } else {
          const response = await getCompatibilityDiscoveryEntries({ cursor });
          nextPageInfo = response.pageInfo;
          nextState = applySuppressedUsers({
            ...stateRef.current,
            compatibilityEntries: [...new Map(
              [...stateRef.current.compatibilityEntries, ...response.entries]
                .map((entry) => [entry.user.id, entry] as const),
            ).values()].sort(
              (left, right) => right.score - left.score || left.user.id.localeCompare(right.user.id),
            ),
          });
        }

        if (activeScopeRef.current !== requestScope) {
          return;
        }

        const committedAt = Date.now();
        const cacheKey = getDiscoveryCacheKey(mode, currentUserId);

        if (cacheKey) {
          cacheDiscoverySnapshot(cacheKey, {
            state: nextState,
            pageInfo: nextPageInfo,
            updatedAt: committedAt,
          });
        }

        stateRef.current = nextState;
        setState(nextState);
        setDiscoveryPageInfo(nextPageInfo);
        setError(null);
        setStatus('success');
        setUpdatedAt(committedAt);
      } catch (caughtError) {
        if (activeScopeRef.current !== requestScope) {
          return;
        }

        setError(normalizeDiscoveryError(caughtError));
        setStatus('stale');
      } finally {
        if (activeScopeRef.current === requestScope) {
          setLoadingMore(false);
        }
      }
    })();

    loadMoreInFlightRef.current = request;

    try {
      await request;
    } finally {
      if (loadMoreInFlightRef.current === request) {
        loadMoreInFlightRef.current = null;
      }
    }
  }, [applySuppressedUsers, currentUserId, discoveryPageInfo, mode]);

  const refresh = useCallback(
    async (showIndicator = false) => {
      await loadData({
        showRefreshing: showIndicator,
        force: true,
      });
    },
    [loadData],
  );

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      return;
    }

    refreshTimeoutRef.current = setTimeout(() => {
      refreshTimeoutRef.current = null;
      void loadData({ force: true });
    }, REALTIME_DEBOUNCE_MS);
  }, [loadData]);

  useEffect(() => {
    loadSequenceRef.current += 1;
    loadInFlightRef.current = null;
    loadMoreInFlightRef.current = null;
    suppressedUserIdsRef.current = new Set();
    setDiscoveryPageInfo(EMPTY_PAGE_INFO);
    setLoadingMore(false);

    const cachedSnapshot = getCachedDiscoverySnapshot(mode, currentUserId);

    if (cachedSnapshot) {
      const nextState = applySuppressedUsers(cachedSnapshot.state);
      stateRef.current = nextState;
      setState(nextState);
      setDiscoveryPageInfo(cachedSnapshot.pageInfo);
      setUpdatedAt(cachedSnapshot.updatedAt);
      setLoading(false);
      setStatus('success');
      setError(null);
    } else if (currentUserId) {
      setLoading(true);
      setStatus('loading');
    } else {
      setState(emptyDiscoveryState());
      setStatus('idle');
      setError(null);
    }

    void loadData({
      showLoading: !cachedSnapshot,
      force: !isDiscoverySnapshotFresh(cachedSnapshot),
    });
  }, [currentUserId, loadData]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const unsubscribeForeground = subscribeToForeground(() => {
      const cachedSnapshot = getCachedDiscoverySnapshot(mode, currentUserId);
      void loadData({ force: !isDiscoverySnapshotFresh(cachedSnapshot) });
    });

    return unsubscribeForeground;
  }, [currentUserId, loadData]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    let wasOffline = isOffline();
    return subscribeToConnectivity(() => {
      const offline = isOffline();
      const recovered = wasOffline && !offline;
      wasOffline = offline;

      if (recovered) {
        void loadData({ force: true });
      }
    });
  }, [currentUserId, loadData]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const unsubscribeUserEvent = subscribeToUserEvent(
      currentUserId,
      'discovery_changed',
      scheduleRefresh,
    );

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }

      unsubscribeUserEvent();
    };
  }, [currentUserId, mode, scheduleRefresh]);

  return {
    watchUsers: state.watchUsers,
    compatibilityEntries: state.compatibilityEntries,
    likedUsers: state.likedUsers,
    likedByUsers: state.likedByUsers,
    likedByUserIds: state.likedByUserIds,
    likedByCount: state.likedByCount,
    likedByLocked: state.likedByLocked,
    loading,
    refreshing,
    status,
    error,
    stale: status === 'stale',
    failed: status === 'error',
    updatedAt,
    hasMore: mode !== 'likes' && discoveryPageInfo.hasMore,
    loadingMore,
    loadMore,
    refresh,
    suppressUser,
  };
}
