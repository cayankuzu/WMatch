import { Image } from 'expo-image';

import { getAppState, subscribeToAppState, subscribeToMemoryWarning } from './appLifecycle';
import {
  canRunSpeculativeNetworkWork,
  getNetworkConcurrencyLimit,
  subscribeToConnectivity,
} from '../../services/connectivity';
import {
  getMediaPrefetchConcurrency,
  getMediaQueueLimit,
} from '../../services/runtimeProfile';

export type MediaPrefetchPriority = 'critical' | 'intent' | 'predictive' | 'idle';

interface MediaPrefetchJob {
  uri: string;
  priority: MediaPrefetchPriority;
  scope: string;
  order: number;
  resolve: (success: boolean) => void;
  promise: Promise<boolean>;
}

const PRIORITY_WEIGHT: Record<MediaPrefetchPriority, number> = {
  critical: 0,
  intent: 1,
  predictive: 2,
  idle: 3,
};
const jobs = new Map<string, MediaPrefetchJob>();
const flights = new Map<string, Promise<boolean>>();
let activePrefetches = 0;
let nextOrder = 0;
let unsubscribeAppState: (() => void) | null = null;
let unsubscribeConnectivity: (() => void) | null = null;
let unsubscribeMemoryWarning: (() => void) | null = null;

function ensureLifecycleSubscription() {
  if (unsubscribeAppState) {
    return;
  }

  unsubscribeAppState = subscribeToAppState((state) => {
    if (state === 'active') {
      runNext();
    }
  });
  unsubscribeConnectivity ??= subscribeToConnectivity(runNext);
  unsubscribeMemoryWarning ??= subscribeToMemoryWarning(() => {
    cancelSpeculativeMediaPrefetches();
    void Image.clearMemoryCache().catch(() => undefined);
  });
}

function getNextJob() {
  return [...jobs.values()]
    .filter((job) => canRunSpeculativeNetworkWork(job.priority))
    .sort((left, right) => {
      const priorityDifference = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
      return priorityDifference || left.order - right.order;
    })[0];
}

function trimQueue() {
  const queueLimit = getMediaQueueLimit();
  if (jobs.size <= queueLimit) {
    return;
  }

  const overflow = [...jobs.values()]
    .sort((left, right) => {
      const priorityDifference = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
      return priorityDifference || right.order - left.order;
    })
    .slice(0, jobs.size - queueLimit);

  overflow.forEach((job) => {
    jobs.delete(job.uri);
    flights.delete(job.uri);
    job.resolve(false);
  });
}

function runNext() {
  if (getAppState() !== 'active') {
    return;
  }

  const concurrencyLimit = Math.min(getMediaPrefetchConcurrency(), getNetworkConcurrencyLimit());

  while (activePrefetches < concurrencyLimit) {
    const job = getNextJob();

    if (!job) {
      return;
    }

    jobs.delete(job.uri);
    activePrefetches += 1;
    void Image.prefetch(job.uri, 'memory-disk')
      .then(job.resolve)
      .catch(() => job.resolve(false))
      .finally(() => {
        activePrefetches -= 1;
        flights.delete(job.uri);
        runNext();
      });
  }
}

/** Prioritizes user-visible media and bounds speculative network pressure. */
export function scheduleMediaPrefetch(
  uri: string,
  priority: MediaPrefetchPriority = 'predictive',
  scope = 'global',
) {
  const existing = jobs.get(uri);
  if (existing) {
    if (PRIORITY_WEIGHT[priority] < PRIORITY_WEIGHT[existing.priority]) {
      existing.priority = priority;
      existing.scope = scope;
    }

    return existing.promise;
  }

  const activeFlight = flights.get(uri);
  if (activeFlight) {
    return activeFlight;
  }

  let resolveJob!: (success: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolveJob = resolve;
  });
  const job: MediaPrefetchJob = {
    uri,
    priority,
    scope,
    order: nextOrder++,
    resolve: resolveJob,
    promise,
  };

  jobs.set(uri, job);
  flights.set(uri, promise);
  trimQueue();
  ensureLifecycleSubscription();
  runNext();
  return promise;
}

export function cancelQueuedMediaPrefetches(scope: string) {
  jobs.forEach((job, uri) => {
    if (job.scope === scope) {
      jobs.delete(uri);
      flights.delete(uri);
      job.resolve(false);
    }
  });
}

export function cancelSpeculativeMediaPrefetches() {
  jobs.forEach((job, uri) => {
    if (job.priority === 'predictive' || job.priority === 'idle') {
      jobs.delete(uri);
      flights.delete(uri);
      job.resolve(false);
    }
  });
}
