import { Image } from 'expo-image';

import { getAppState, subscribeToAppState } from './appLifecycle';

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
const MAX_CONCURRENT_PREFETCHES = 3;
const MAX_QUEUED_PREFETCHES = 48;
const jobs = new Map<string, MediaPrefetchJob>();
const flights = new Map<string, Promise<boolean>>();
let activePrefetches = 0;
let nextOrder = 0;
let unsubscribeAppState: (() => void) | null = null;

function ensureLifecycleSubscription() {
  if (unsubscribeAppState) {
    return;
  }

  unsubscribeAppState = subscribeToAppState((state) => {
    if (state === 'active') {
      runNext();
    }
  });
}

function getNextJob() {
  return [...jobs.values()].sort((left, right) => {
    const priorityDifference = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    return priorityDifference || left.order - right.order;
  })[0];
}

function trimQueue() {
  if (jobs.size <= MAX_QUEUED_PREFETCHES) {
    return;
  }

  const overflow = [...jobs.values()]
    .sort((left, right) => {
      const priorityDifference = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
      return priorityDifference || right.order - left.order;
    })
    .slice(0, jobs.size - MAX_QUEUED_PREFETCHES);

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

  while (activePrefetches < MAX_CONCURRENT_PREFETCHES) {
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
