import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocalization } from '../../context/LocalizationContext';
import { getLiveNowUsers, type LiveNowResponse } from '../../services/api';
import type { ApiUser } from '../../shared/types';
import { LIVE_NOW_PAGE_SIZE } from '../../shared/constants';
import { isAppActive } from '../../shared/utils/appLifecycle';
import { subscribeToUserEvent } from '../../services/userEventBus';

const REFRESH_DEDUPE_MS = 5_000;
const EVENT_DEBOUNCE_MS = 350;
const FALLBACK_POLL_INTERVAL_MS = 30_000;
const EMPTY_PAGE_INFO: LiveNowResponse['pageInfo'] = { hasMore: false, nextCursor: null };

function mergeUniqueWatchUsers(current: ApiUser[], incoming: ApiUser[]) {
  const merged = new Map<string, ApiUser>();

  [...current, ...incoming].forEach((user) => {
    if (user.currentlyWatching) {
      const mediaType = user.currentlyWatchingMediaType ?? 'movie';
      merged.set(`${user.id}:${mediaType}:${user.currentlyWatching}`, user);
    }
  });

  return [...merged.values()];
}

export default function useLiveNowUsers(userId: string | null, isFocused: boolean) {
  const { t } = useLocalization();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [pageInfo, setPageInfo] = useState(EMPTY_PAGE_INFO);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeSubscribed, setRealtimeSubscribed] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const sequenceRef = useRef(0);
  const scopeRef = useRef<string | null>(userId);
  const lastFetchAtRef = useRef(0);
  const pageInfoRef = useRef(pageInfo);
  const eventTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (options: { append?: boolean; force?: boolean } = {}) => {
    if (!userId) {
      sequenceRef.current += 1;
      scopeRef.current = null;
      inFlightRef.current = null;
      lastFetchAtRef.current = 0;
      pageInfoRef.current = EMPTY_PAGE_INFO;
      setUsers([]);
      setPageInfo(EMPTY_PAGE_INFO);
      setError(null);
      setLoading(false);
      return;
    }

    if (scopeRef.current !== userId) {
      sequenceRef.current += 1;
      scopeRef.current = userId;
      inFlightRef.current = null;
      lastFetchAtRef.current = 0;
      pageInfoRef.current = EMPTY_PAGE_INFO;
      setUsers([]);
      setPageInfo(EMPTY_PAGE_INFO);
      setLoading(true);
    }

    const append = Boolean(options.append);
    const currentFlight = inFlightRef.current;

    if (currentFlight) {
      await currentFlight;

      if (!options.force) {
        return;
      }

      if (inFlightRef.current && inFlightRef.current !== currentFlight) {
        return inFlightRef.current;
      }
    }

    if (!append && !options.force) {
      const now = Date.now();
      if (now - lastFetchAtRef.current < REFRESH_DEDUPE_MS) {
        return;
      }
      lastFetchAtRef.current = now;
    }

    const requestScope = userId;
    const requestSequence = ++sequenceRef.current;
    const request = (async () => {
      try {
        const response = await getLiveNowUsers({
          cursor: append ? pageInfoRef.current.nextCursor : null,
          limit: LIVE_NOW_PAGE_SIZE,
          force: options.force,
        });

        if (scopeRef.current !== requestScope || sequenceRef.current !== requestSequence) {
          return;
        }

        setUsers((current) => append ? mergeUniqueWatchUsers(current, response.users) : response.users);
        pageInfoRef.current = response.pageInfo;
        setPageInfo(response.pageInfo);
        setError(null);
      } catch (loadError) {
        console.warn('Watching users could not be refreshed:', loadError);
        if (scopeRef.current === requestScope && sequenceRef.current === requestSequence) {
          setError(loadError instanceof Error ? loadError.message : t('data.error.generic'));
        }
      } finally {
        if (scopeRef.current === requestScope && sequenceRef.current === requestSequence) {
          setLoading(false);
        }
      }
    })();

    inFlightRef.current = request;

    try {
      await request;
    } finally {
      if (inFlightRef.current === request) {
        inFlightRef.current = null;
      }
    }
  }, [t, userId]);

  useEffect(() => {
    if (!userId) {
      void load();
    }
  }, [load, userId]);

  useEffect(() => {
    if (!userId || !isFocused) {
      return;
    }

    void load();
    if (realtimeSubscribed) {
      return;
    }

    const intervalId = setInterval(() => {
      if (isAppActive()) {
        void load();
      }
    }, FALLBACK_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isFocused, load, realtimeSubscribed, userId]);

  useEffect(() => {
    if (!userId || !isFocused) {
      return;
    }

    const scheduleRefresh = () => {
      if (!isAppActive()) {
        return;
      }

      if (eventTimeoutRef.current) {
        clearTimeout(eventTimeoutRef.current);
      }

      eventTimeoutRef.current = setTimeout(() => {
        eventTimeoutRef.current = null;
        void load({ force: true });
      }, EVENT_DEBOUNCE_MS);
    };

    const unsubscribeUserEvent = subscribeToUserEvent(userId, 'discovery_changed', scheduleRefresh, (status) => {
      if (status === 'SUBSCRIBED') {
        setRealtimeSubscribed(true);
        void load();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setRealtimeSubscribed(false);
      }
    });

    return () => {
      setRealtimeSubscribed(false);
      if (eventTimeoutRef.current) {
        clearTimeout(eventTimeoutRef.current);
        eventTimeoutRef.current = null;
      }
      unsubscribeUserEvent();
    };
  }, [isFocused, load, userId]);

  const loadMore = useCallback(() => load({ append: true }), [load]);

  return {
    users,
    pageInfo,
    loading,
    error,
    refresh: load,
    loadMore,
  };
}
