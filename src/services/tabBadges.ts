import { useSyncExternalStore } from 'react';

import type { AppTab } from '../shared/types';

type TabBadges = Partial<Record<AppTab, number>>;
type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: TabBadges = {};

export function setTabBadge(tab: AppTab, count: number) {
  const normalizedCount = Math.max(0, Math.floor(count));
  if ((snapshot[tab] ?? 0) === normalizedCount) {
    return;
  }

  snapshot = { ...snapshot, [tab]: normalizedCount };
  listeners.forEach((listener) => listener());
}

export function clearTabBadges() {
  snapshot = {};
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

export function useTabBadges() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
