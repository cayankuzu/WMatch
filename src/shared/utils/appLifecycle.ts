import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

type AppStateListener = (state: AppStateStatus) => void;
type MemoryWarningListener = () => void;

const listeners = new Set<AppStateListener>();
let currentState = AppState.currentState;
let nativeSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
const memoryWarningListeners = new Set<MemoryWarningListener>();
let memoryWarningSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

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

export function subscribeToMemoryWarning(listener: MemoryWarningListener) {
  memoryWarningListeners.add(listener);

  if (!memoryWarningSubscription) {
    memoryWarningSubscription = AppState.addEventListener('memoryWarning', () => {
      memoryWarningListeners.forEach((memoryListener) => memoryListener());
    });
  }

  return () => {
    memoryWarningListeners.delete(listener);
    if (memoryWarningListeners.size === 0 && memoryWarningSubscription) {
      memoryWarningSubscription.remove();
      memoryWarningSubscription = null;
    }
  };
}

export function useAppStateStatus() {
  return useSyncExternalStore(subscribeToAppState, getAppState, getAppState);
}
