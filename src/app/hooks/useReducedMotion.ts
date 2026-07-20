import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

const listeners = new Set<() => void>();
let reduceMotionEnabled = false;
let initialized = false;
let nativeSubscription: ReturnType<typeof AccessibilityInfo.addEventListener> | null = null;

function updateReducedMotion(enabled: boolean) {
  if (reduceMotionEnabled === enabled) {
    return;
  }

  reduceMotionEnabled = enabled;
  listeners.forEach((listener) => listener());
}

function ensureSubscription() {
  if (!initialized) {
    initialized = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(updateReducedMotion).catch(() => undefined);
  }

  if (!nativeSubscription) {
    nativeSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', updateReducedMotion);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureSubscription();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && nativeSubscription) {
      nativeSubscription.remove();
      nativeSubscription = null;
    }
  };
}

function getSnapshot() {
  return reduceMotionEnabled;
}

export default function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
