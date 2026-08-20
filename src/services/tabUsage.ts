import AsyncStorage from '@react-native-async-storage/async-storage';

import { storageKeys } from '../shared/constants/storage';
import type { AppTab } from '../shared/types';

const MAX_HISTORY_LENGTH = 3;
const DEFAULT_ORDER: AppTab[] = ['match', 'chat', 'likes', 'compatibility', 'profile'];
const STATE_VERSION = 1;

interface TabUsageState {
  version: typeof STATE_VERSION;
  lastTab: AppTab;
  history: AppTab[];
}

const DEFAULT_STATE: TabUsageState = {
  version: STATE_VERSION,
  lastTab: 'watch',
  history: [],
};
const memoryState = new Map<string, TabUsageState>();

function isAppTab(value: unknown): value is AppTab {
  return value === 'watch' || value === 'match' || value === 'compatibility' || value === 'likes' || value === 'chat' || value === 'profile';
}

function normalizeState(value: unknown): TabUsageState {
  if (Array.isArray(value)) {
    const history = value.filter(isAppTab).slice(0, MAX_HISTORY_LENGTH);
    return { ...DEFAULT_STATE, lastTab: history[0] ?? 'watch', history };
  }

  if (!value || typeof value !== 'object') {
    return DEFAULT_STATE;
  }

  const candidate = value as Partial<TabUsageState>;
  const history = Array.isArray(candidate.history)
    ? candidate.history.filter(isAppTab).slice(0, MAX_HISTORY_LENGTH)
    : [];

  return {
    version: STATE_VERSION,
    lastTab: isAppTab(candidate.lastTab) ? candidate.lastTab : history[0] ?? 'watch',
    history,
  };
}

async function loadState(userId: string) {
  const cached = memoryState.get(userId);
  if (cached) {
    return cached;
  }

  let state = DEFAULT_STATE;
  try {
    const rawValue = await AsyncStorage.getItem(storageKeys.tabUsage(userId));
    state = normalizeState(rawValue ? JSON.parse(rawValue) as unknown : null);
  } catch {
    // A corrupt preference must never block navigation.
  }

  memoryState.set(userId, state);
  return state;
}

export async function loadLastActiveTab(userId: string) {
  return (await loadState(userId)).lastTab;
}

export async function loadTabWarmupOrder(userId: string, currentTab: AppTab) {
  const { history } = await loadState(userId);

  return [...new Set([...history, ...DEFAULT_ORDER])]
    .filter((tab) => tab !== currentTab && tab !== 'watch')
    .slice(0, 2);
}

export function recordTabUsage(userId: string, tab: AppTab) {
  void loadState(userId).then((current) => {
    const history = tab === 'watch'
      ? current.history
      : [tab, ...current.history.filter((item) => item !== tab)].slice(0, MAX_HISTORY_LENGTH);
    const next: TabUsageState = { version: STATE_VERSION, lastTab: tab, history };
    memoryState.set(userId, next);
    return AsyncStorage.setItem(storageKeys.tabUsage(userId), JSON.stringify(next));
  }).catch(() => undefined);
}
