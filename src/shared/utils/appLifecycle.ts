import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type AppStateListener = (state: AppStateStatus) => void;

const listeners = new Set<AppStateListener>();
let currentState = AppState.currentState;
let nativeSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

function ensureNativeSubscription() {
  if (nativeSubscription) {
    return;
  }

  nativeSubscription = AppState.addEventListener('change', (nextState) => {
    currentState = nextState;
    listeners.forEach((listener) => listener(nextState));
  });
}

function releaseNativeSubscriptionIfIdle() {
  if (listeners.size > 0 || !nativeSubscription) {
    return;
  }

  nativeSubscription.remove();
  nativeSubscription = null;
}

export function getAppState() {
  return currentState;
}

export function isAppActive() {
  return currentState === 'active';
}

export function subscribeToAppState(listener: AppStateListener) {
  listeners.add(listener);
  ensureNativeSubscription();

  return () => {
    listeners.delete(listener);
    releaseNativeSubscriptionIfIdle();
  };
}

export function subscribeToForeground(listener: () => void) {
  return subscribeToAppState((state) => {
    if (state === 'active') {
      listener();
    }
  });
}

export function useAppStateStatus() {
  return useSyncExternalStore(subscribeToAppState, getAppState, getAppState);
}
