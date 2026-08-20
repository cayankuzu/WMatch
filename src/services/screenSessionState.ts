import AsyncStorage from '@react-native-async-storage/async-storage';

import { storageKeys } from '../shared/constants/storage';
import type { FilterType } from '../shared/types';
import { BoundedMap } from '../shared/utils/boundedMap';
import { registerSessionCache } from '../shared/utils/sessionCache';

interface ScreenSessionState {
  chat: {
    filter: FilterType;
    scrollOffset: number;
  };
  likes: {
    activeTab: 'liked' | 'likedme';
    likedScrollOffset: number;
    likedMeScrollOffset: number;
  };
}

const DEFAULT_STATE: ScreenSessionState = {
  chat: {
    filter: 'all',
    scrollOffset: 0,
  },
  likes: {
    activeTab: 'liked',
    likedScrollOffset: 0,
    likedMeScrollOffset: 0,
  },
};

const PERSIST_DEBOUNCE_MS = 350;
const stateByScope = new BoundedMap<string, ScreenSessionState[keyof ScreenSessionState]>(32);
const hydratedScopes = new Set<string>();
const hydrationFlights = new Map<string, Promise<ScreenSessionState[keyof ScreenSessionState]>>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
registerSessionCache(() => {
  stateByScope.clear();
  hydratedScopes.clear();
  hydrationFlights.clear();
  persistTimers.forEach(clearTimeout);
  persistTimers.clear();
});

function scopeKey(userId: string, screen: keyof ScreenSessionState) {
  return `${userId}:${screen}`;
}

function normalizeOffset(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeState<Screen extends keyof ScreenSessionState>(
  screen: Screen,
  value: unknown,
): ScreenSessionState[Screen] {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  if (screen === 'chat') {
    const filter = candidate.filter;
    return {
      filter: filter === 'unread' || filter === 'read' || filter === 'ended' || filter === 'blocked'
        ? filter
        : 'all',
      scrollOffset: normalizeOffset(candidate.scrollOffset),
    } as ScreenSessionState[Screen];
  }

  return {
    activeTab: candidate.activeTab === 'likedme' ? 'likedme' : 'liked',
    likedScrollOffset: normalizeOffset(candidate.likedScrollOffset),
    likedMeScrollOffset: normalizeOffset(candidate.likedMeScrollOffset),
  } as ScreenSessionState[Screen];
}

export function hydrateScreenSessionState<Screen extends keyof ScreenSessionState>(
  userId: string,
  screen: Screen,
): Promise<ScreenSessionState[Screen]> {
  const key = scopeKey(userId, screen);
  if (hydratedScopes.has(key)) {
    return Promise.resolve(readScreenSessionState(userId, screen));
  }

  const existingFlight = hydrationFlights.get(key);
  if (existingFlight) {
    return existingFlight as Promise<ScreenSessionState[Screen]>;
  }

  const flight = AsyncStorage.getItem(storageKeys.screenState(userId, screen))
    .then((rawValue) => normalizeState(screen, rawValue ? JSON.parse(rawValue) as unknown : null))
    .catch(() => DEFAULT_STATE[screen])
    .then((state) => {
      if (hydratedScopes.has(key)) {
        return readScreenSessionState(userId, screen);
      }

      stateByScope.set(key, state);
      hydratedScopes.add(key);
      return state;
    })
    .finally(() => hydrationFlights.delete(key));

  hydrationFlights.set(key, flight);
  return flight;
}

export function readScreenSessionState<Screen extends keyof ScreenSessionState>(
  userId: string,
  screen: Screen,
): ScreenSessionState[Screen] {
  return (
    stateByScope.get(scopeKey(userId, screen)) as ScreenSessionState[Screen] | undefined
  ) ?? DEFAULT_STATE[screen];
}

export function patchScreenSessionState<Screen extends keyof ScreenSessionState>(
  userId: string,
  screen: Screen,
  patch: Partial<ScreenSessionState[Screen]>,
) {
  const key = scopeKey(userId, screen);
  const next = {
    ...readScreenSessionState(userId, screen),
    ...patch,
  };
  stateByScope.set(key, next);
  hydratedScopes.add(key);

  const pendingTimer = persistTimers.get(key);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
  }

  persistTimers.set(key, setTimeout(() => {
    persistTimers.delete(key);
    void AsyncStorage.setItem(storageKeys.screenState(userId, screen), JSON.stringify(next)).catch(() => undefined);
  }, PERSIST_DEBOUNCE_MS));
}
