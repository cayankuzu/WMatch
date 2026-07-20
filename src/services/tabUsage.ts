import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppTab } from '../shared/types';

const STORAGE_PREFIX = 'wmatch:tab-history:';
const MAX_HISTORY_LENGTH = 3;
const DEFAULT_ORDER: AppTab[] = ['match', 'chat', 'likes', 'compatibility', 'profile'];
const memoryHistory = new Map<string, AppTab[]>();

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function isAppTab(value: unknown): value is AppTab {
  return value === 'watch' || value === 'match' || value === 'compatibility' || value === 'likes' || value === 'chat' || value === 'profile';
}

export async function loadTabWarmupOrder(userId: string, currentTab: AppTab) {
  let history = memoryHistory.get(userId);

  if (!history) {
    try {
      const rawValue = await AsyncStorage.getItem(storageKey(userId));
      const parsedValue = rawValue ? JSON.parse(rawValue) as unknown : [];
      history = Array.isArray(parsedValue) ? parsedValue.filter(isAppTab).slice(0, MAX_HISTORY_LENGTH) : [];
    } catch {
      history = [];
    }

    memoryHistory.set(userId, history);
  }

  return [...new Set([...history, ...DEFAULT_ORDER])]
    .filter((tab) => tab !== currentTab && tab !== 'watch');
}

export function recordTabUsage(userId: string, tab: AppTab) {
  if (tab === 'watch') {
    return;
  }

  const current = memoryHistory.get(userId) ?? [];
  const next = [tab, ...current.filter((item) => item !== tab)].slice(0, MAX_HISTORY_LENGTH);
  memoryHistory.set(userId, next);
  void AsyncStorage.setItem(storageKey(userId), JSON.stringify(next)).catch(() => undefined);
}
