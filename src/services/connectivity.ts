import { useSyncExternalStore } from 'react';
import * as Network from 'expo-network';

type ConnectivitySnapshot = {
  connected: boolean;
  internetReachable: boolean;
  type: Network.NetworkStateType;
};

type ConnectivityListener = () => void;

const listeners = new Set<ConnectivityListener>();
let snapshot: ConnectivitySnapshot = {
  connected: true,
  internetReachable: true,
  type: Network.NetworkStateType.UNKNOWN,
};
let subscription: ReturnType<typeof Network.addNetworkStateListener> | null = null;
let hydrationStarted = false;

function normalizeNetworkState(state: Network.NetworkState): ConnectivitySnapshot {
  return {
    connected: state.isConnected !== false,
    internetReachable: state.isInternetReachable !== false,
    type: state.type ?? Network.NetworkStateType.UNKNOWN,
  };
}

function commit(next: ConnectivitySnapshot) {
  if (
    snapshot.connected === next.connected &&
    snapshot.internetReachable === next.internetReachable &&
    snapshot.type === next.type
  ) {
    return;
  }

  snapshot = next;
  listeners.forEach((listener) => listener());
}

function ensureSubscription() {
  if (!subscription) {
    subscription = Network.addNetworkStateListener((state) => commit(normalizeNetworkState(state)));
  }

  if (!hydrationStarted) {
    hydrationStarted = true;
    void Network.getNetworkStateAsync()
      .then((state) => commit(normalizeNetworkState(state)))
      .catch(() => undefined);
  }
}

export function getConnectivitySnapshot() {
  ensureSubscription();
  return snapshot;
}

export function subscribeToConnectivity(listener: ConnectivityListener) {
  listeners.add(listener);
  ensureSubscription();
  return () => {
    listeners.delete(listener);
  };
}

export function useConnectivity() {
  return useSyncExternalStore(subscribeToConnectivity, getConnectivitySnapshot, getConnectivitySnapshot);
}

export function isOffline() {
  const current = getConnectivitySnapshot();
  return !current.connected || !current.internetReachable;
}

export function canRunSpeculativeNetworkWork(priority: 'critical' | 'intent' | 'predictive' | 'idle') {
  const current = getConnectivitySnapshot();

  if (!current.connected || !current.internetReachable) {
    return false;
  }

  return !(current.type === Network.NetworkStateType.CELLULAR && priority === 'idle');
}

export function getNetworkConcurrencyLimit() {
  const current = getConnectivitySnapshot();

  if (!current.connected || !current.internetReachable) {
    return 0;
  }

  return current.type === Network.NetworkStateType.CELLULAR ? 1 : Number.POSITIVE_INFINITY;
}
