import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { consumeSwipeQuota, getSwipeQuota } from '../../services/api';
import {
  DAILY_DISLIKE_SWIPE_LIMIT,
  DAILY_LIKE_SWIPE_LIMIT,
  DAILY_UNDO_LIMIT,
  SWIPE_QUOTA_WINDOW_HOURS,
} from '../../shared/constants';
import type { SwipeQuotaKind, SwipeQuotaState } from '../../shared/types';
import { getServerNowMs } from '../../shared/utils/serverTime';
import { registerSessionCache } from '../../shared/utils/sessionCache';

const quotaCache = new Map<string, SwipeQuotaState | null>();
const quotaListeners = new Map<string, Set<(state: SwipeQuotaState | null) => void>>();
const quotaHydrationFlights = new Map<string, Promise<SwipeQuotaState | null>>();
const quotaPersistFlights = new Map<string, Promise<void>>();
const quotaRefreshFlights = new Map<string, Promise<SwipeQuotaState | null>>();
const quotaLastServerStateAt = new Map<string, number>();
const clockListeners = new Set<(now: number) => void>();
const foregroundListeners = new Set<() => void>();
let clockInterval: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let cacheGeneration = 0;
const SWIPE_QUOTA_STORAGE_PREFIX = 'wmatch:swipe-quota:';
const SWIPE_QUOTA_REVALIDATE_AFTER_MS = 30_000;

registerSessionCache(() => {
  cacheGeneration += 1;
  quotaCache.clear();
  quotaHydrationFlights.clear();
  quotaPersistFlights.clear();
  quotaRefreshFlights.clear();
  quotaLastServerStateAt.clear();
});

function subscribeClock(listener: (now: number) => void) {
  clockListeners.add(listener);

  if (!clockInterval) {
    clockInterval = setInterval(() => {
      const now = getServerNowMs();
      clockListeners.forEach((currentListener) => currentListener(now));
    }, 1000);
  }

  return () => {
    clockListeners.delete(listener);

    if (clockListeners.size === 0 && clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  };
}

function subscribeForeground(listener: () => void) {
  foregroundListeners.add(listener);

  if (!appStateSubscription) {
    appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        foregroundListeners.forEach((currentListener) => currentListener());
      }
    });
  }

  return () => {
    foregroundListeners.delete(listener);

    if (foregroundListeners.size === 0 && appStateSubscription) {
      appStateSubscription.remove();
      appStateSubscription = null;
    }
  };
}

function buildFallbackState(now = getServerNowMs()): SwipeQuotaState {
  const resetsAtMs = now + SWIPE_QUOTA_WINDOW_HOURS * 60 * 60 * 1000;

  return {
    windowStartedAt: new Date(now).toISOString(),
    likeLimit: DAILY_LIKE_SWIPE_LIMIT,
    dislikeLimit: DAILY_DISLIKE_SWIPE_LIMIT,
    undoLimit: DAILY_UNDO_LIMIT,
    usedLikes: 0,
    usedDislikes: 0,
    usedUndos: 0,
    remainingLikes: DAILY_LIKE_SWIPE_LIMIT,
    remainingDislikes: DAILY_DISLIKE_SWIPE_LIMIT,
    remainingUndos: DAILY_UNDO_LIMIT,
    resetsAt: new Date(resetsAtMs).toISOString(),
    remainingMs: resetsAtMs - now,
  };
}

function withLiveRemaining(state: SwipeQuotaState, now = getServerNowMs()): SwipeQuotaState {
  const resetsAtMs = new Date(state.resetsAt).getTime();

  if (!Number.isFinite(resetsAtMs)) {
    return buildFallbackState(now);
  }

  if (resetsAtMs <= now) {
    return buildFallbackState(now);
  }

  return {
    ...state,
    remainingMs: Math.max(0, resetsAtMs - now),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getSwipeQuotaStorageKey(userId: string) {
  return `${SWIPE_QUOTA_STORAGE_PREFIX}${userId}`;
}

function rebuildState(base: SwipeQuotaState, now = getServerNowMs()): SwipeQuotaState {
  const liveBase = withLiveRemaining(base, now);
  const likeLimit = Math.max(0, Number(liveBase.likeLimit || DAILY_LIKE_SWIPE_LIMIT));
  const dislikeLimit = Math.max(0, Number(liveBase.dislikeLimit || DAILY_DISLIKE_SWIPE_LIMIT));
  const undoLimit = Math.max(0, Number(liveBase.undoLimit || DAILY_UNDO_LIMIT));
  const usedLikes = clamp(Number(liveBase.usedLikes || 0), 0, likeLimit);
  const usedDislikes = clamp(Number(liveBase.usedDislikes || 0), 0, dislikeLimit);
  const usedUndos = clamp(Number(liveBase.usedUndos || 0), 0, undoLimit);

  return {
    ...liveBase,
    likeLimit,
    dislikeLimit,
    undoLimit,
    usedLikes,
    usedDislikes,
    usedUndos,
    remainingLikes: Math.max(0, likeLimit - usedLikes),
    remainingDislikes: Math.max(0, dislikeLimit - usedDislikes),
    remainingUndos: Math.max(0, undoLimit - usedUndos),
  };
}

function queuePersistState(userId: string, nextState: SwipeQuotaState | null) {
  const generation = cacheGeneration;
  const previousFlight = quotaPersistFlights.get(userId) ?? Promise.resolve();
  const nextFlight = previousFlight
    .catch(() => undefined)
    .then(async () => {
      if (generation !== cacheGeneration) {
        return;
      }

      try {
        const storageKey = getSwipeQuotaStorageKey(userId);

        if (!nextState) {
          await AsyncStorage.removeItem(storageKey);
          return;
        }

        await AsyncStorage.setItem(storageKey, JSON.stringify(nextState));
      } catch (error) {
        console.warn('Swipe quota cache could not be persisted:', error);
      }
    });

  quotaPersistFlights.set(userId, nextFlight);
  void nextFlight.finally(() => {
    if (quotaPersistFlights.get(userId) === nextFlight) {
      quotaPersistFlights.delete(userId);
    }
  });
}

async function readPersistedState(userId: string) {
  const storageKey = getSwipeQuotaStorageKey(userId);

  try {
    const rawValue = await AsyncStorage.getItem(storageKey);

    if (!rawValue) {
      return null;
    }

    return rebuildState(JSON.parse(rawValue) as SwipeQuotaState);
  } catch (error) {
    console.warn('Persisted swipe quota could not be restored:', error);
    await AsyncStorage.removeItem(storageKey).catch(() => undefined);
    return null;
  }
}

function publishState(userId: string, nextState: SwipeQuotaState | null) {
  quotaCache.set(userId, nextState);
  queuePersistState(userId, nextState);
  const listeners = quotaListeners.get(userId);

  if (!listeners) {
    return;
  }

  listeners.forEach((listener) => {
    listener(nextState);
  });
}

function subscribeState(userId: string, listener: (state: SwipeQuotaState | null) => void) {
  const listeners = quotaListeners.get(userId) ?? new Set<(state: SwipeQuotaState | null) => void>();
  listeners.add(listener);
  quotaListeners.set(userId, listeners);

  return () => {
    const current = quotaListeners.get(userId);

    if (!current) {
      return;
    }

    current.delete(listener);

    if (current.size === 0) {
      quotaListeners.delete(userId);
    }
  };
}

function getCachedState(userId: string) {
  return quotaCache.get(userId) ?? null;
}

function mutateUsage(userId: string, kind: SwipeQuotaKind, delta: number) {
  const baseState = getCachedState(userId);

  if (!baseState) {
    return null;
  }

  const nextState = rebuildState({
    ...baseState,
    usedLikes: baseState.usedLikes + (kind === 'like' ? delta : 0),
    usedDislikes: baseState.usedDislikes + (kind === 'dislike' ? delta : 0),
    usedUndos: baseState.usedUndos + (kind === 'undo' ? delta : 0),
  });

  publishState(userId, nextState);
  return nextState;
}

async function hydrateState(userId: string) {
  const existingFlight = quotaHydrationFlights.get(userId);

  if (existingFlight) {
    return existingFlight;
  }

  const generation = cacheGeneration;
  const nextFlight = (async () => {
    const cachedState = getCachedState(userId);

    if (cachedState) {
      return cachedState;
    }

    const persistedState = await readPersistedState(userId);

    if (persistedState && generation === cacheGeneration) {
      publishState(userId, persistedState);
    }

    return persistedState;
  })().finally(() => {
    if (generation === cacheGeneration) {
      quotaHydrationFlights.delete(userId);
    }
  });

  quotaHydrationFlights.set(userId, nextFlight);
  return nextFlight;
}

async function refreshState(userId: string, force = true) {
  const existingFlight = quotaRefreshFlights.get(userId);

  if (existingFlight) {
    return existingFlight;
  }

  const cachedState = getCachedState(userId);
  const lastServerStateAt = quotaLastServerStateAt.get(userId) ?? 0;
  if (!force && cachedState && Date.now() - lastServerStateAt < SWIPE_QUOTA_REVALIDATE_AFTER_MS) {
    return cachedState;
  }

  const nextFlight = (async () => {
    const generation = cacheGeneration;
    try {
      const nextState = rebuildState(await getSwipeQuota());
      if (generation === cacheGeneration) {
        quotaLastServerStateAt.set(userId, Date.now());
        publishState(userId, nextState);
      }
      return nextState;
    } catch (error) {
      console.warn('Failed to load swipe quota:', error);
      const cachedState = getCachedState(userId);

      if (!cachedState || generation !== cacheGeneration) {
        return null;
      }

      const liveCachedState = rebuildState(cachedState);
      publishState(userId, liveCachedState);
      return liveCachedState;
    } finally {
      if (generation === cacheGeneration) {
        quotaRefreshFlights.delete(userId);
      }
    }
  })();

  quotaRefreshFlights.set(userId, nextFlight);
  return nextFlight;
}

export async function preloadSwipeQuota(userId: string) {
  await hydrateState(userId);
  return refreshState(userId, false);
}

export default function useSwipeQuota(userId?: string | null) {
  const [state, setState] = useState<SwipeQuotaState | null>(() => (userId ? getCachedState(userId) : null));
  const [hydrated, setHydrated] = useState(() => !userId);
  const [tick, setTick] = useState(getServerNowMs());

  useEffect(() => subscribeClock(setTick), []);

  useEffect(() => {
    if (!userId) {
      setState(null);
      setHydrated(true);
      return;
    }

    let cancelled = false;

    setHydrated(false);
    setState(getCachedState(userId));
    const unsubscribe = subscribeState(userId, setState);

    void hydrateState(userId).finally(() => {
      if (cancelled) {
        return;
      }

      setState(getCachedState(userId));
      setHydrated(true);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) {
      setState(null);
      return null;
    }

    return refreshState(userId, true);
  }, [userId]);

  const refreshIfStale = useCallback(async () => {
    if (!userId) {
      return null;
    }

    return refreshState(userId, false);
  }, [userId]);

  useEffect(() => {
    if (!userId || !hydrated) {
      return;
    }

    void refreshIfStale();
  }, [hydrated, refreshIfStale, userId]);

  useEffect(() => {
    if (!userId || !hydrated) {
      return;
    }

    return subscribeForeground(() => {
      void refreshIfStale();
    });
  }, [hydrated, refreshIfStale, userId]);

  const optimisticConsume = useCallback((kind: SwipeQuotaKind) => {
    if (!userId) {
      return false;
    }

    const cachedState = getCachedState(userId);

    if (!cachedState) {
      return false;
    }

    const current = rebuildState(cachedState);

    if (
      (kind === 'like' && current.remainingLikes <= 0) ||
      (kind === 'dislike' && current.remainingDislikes <= 0) ||
      (kind === 'undo' && current.remainingUndos <= 0)
    ) {
      return false;
    }

    return mutateUsage(userId, kind, 1) != null;
  }, [userId]);

  const optimisticRestore = useCallback((kind: SwipeQuotaKind) => {
    if (!userId) {
      return;
    }

    mutateUsage(userId, kind, -1);
  }, [userId]);

  const applyServerState = useCallback((nextState: SwipeQuotaState) => {
    if (!userId) {
      return;
    }

    quotaLastServerStateAt.set(userId, Date.now());
    publishState(userId, rebuildState(nextState));
  }, [userId]);

  const consumeSwipe = useCallback(
    async (direction: Extract<SwipeQuotaKind, 'like' | 'dislike'>) => {
      if (!userId) {
        return false;
      }

      try {
        const nextState = rebuildState(await consumeSwipeQuota(direction));
        quotaLastServerStateAt.set(userId, Date.now());
        publishState(userId, nextState);
        return true;
      } catch (error) {
        console.warn(`Failed to consume ${direction} swipe quota:`, error);
        return false;
      }
    },
    [userId],
  );

  const consumeUndo = useCallback(async () => {
    if (!userId) {
      return false;
    }

    try {
      const nextState = rebuildState(await consumeSwipeQuota('undo'));
      quotaLastServerStateAt.set(userId, Date.now());
      publishState(userId, nextState);
      return true;
    } catch (error) {
      console.warn('Failed to consume undo quota:', error);
      return false;
    }
  }, [userId]);

  const liveState = useMemo(() => (state ? rebuildState(state, tick) : null), [state, tick]);
  const displayState = useMemo(() => liveState ?? buildFallbackState(tick), [liveState, tick]);

  return {
    ...displayState,
    ready: liveState != null,
    loading: Boolean(userId) && !hydrated && liveState == null,
    refresh,
    consumeSwipe,
    consumeUndo,
    optimisticConsume,
    optimisticRestore,
    applyServerState,
  };
}
