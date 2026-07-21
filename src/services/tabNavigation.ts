import type { AppTab } from '../shared/types';

type TabReselectListener = () => void;

const listeners = new Map<AppTab, Set<TabReselectListener>>();

export function emitTabReselected(tab: AppTab) {
  listeners.get(tab)?.forEach((listener) => listener());
}

export function subscribeToTabReselect(tab: AppTab, listener: TabReselectListener) {
  const tabListeners = listeners.get(tab) ?? new Set<TabReselectListener>();
  tabListeners.add(listener);
  listeners.set(tab, tabListeners);

  return () => {
    tabListeners.delete(listener);
    if (tabListeners.size === 0) {
      listeners.delete(tab);
    }
  };
}
