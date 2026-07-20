import { getAppState, subscribeToAppState } from '../shared/utils/appLifecycle';

export type LaunchTaskPriority = 'critical' | 'intent' | 'predictive' | 'idle';

interface ScheduleTaskOptions<T> {
  key: string;
  priority: LaunchTaskPriority;
  run: () => Promise<T>;
}

interface ScheduledTask<T = unknown> extends ScheduleTaskOptions<T> {
  order: number;
  started: boolean;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const PRIORITY_WEIGHT: Record<LaunchTaskPriority, number> = {
  critical: 0,
  intent: 1,
  predictive: 2,
  idle: 3,
};
const MAX_CONCURRENT_TASKS = 2;
const tasks = new Map<string, ScheduledTask>();
let activeTasks = 0;
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

function getNextTask() {
  return [...tasks.values()]
    .filter((task) => !task.started)
    .sort((left, right) => {
      const priorityDifference = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
      return priorityDifference || left.order - right.order;
    })[0];
}

function runNext() {
  if (getAppState() !== 'active') {
    return;
  }

  while (activeTasks < MAX_CONCURRENT_TASKS) {
    const task = getNextTask();

    if (!task) {
      return;
    }

    task.started = true;
    activeTasks += 1;
    void task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activeTasks -= 1;
        tasks.delete(task.key);
        runNext();
      });
  }
}

export function scheduleLaunchTask<T>({ key, priority, run }: ScheduleTaskOptions<T>) {
  const existing = tasks.get(key) as ScheduledTask<T> | undefined;

  if (existing) {
    if (!existing.started && PRIORITY_WEIGHT[priority] < PRIORITY_WEIGHT[existing.priority]) {
      existing.priority = priority;
      existing.run = run;
    }

    return existing.promise;
  }

  let resolveTask!: (value: T) => void;
  let rejectTask!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });
  const task: ScheduledTask<T> = {
    key,
    priority,
    run,
    order: nextOrder++,
    started: false,
    promise,
    resolve: resolveTask,
    reject: rejectTask,
  };

  tasks.set(key, task as ScheduledTask);
  ensureLifecycleSubscription();
  runNext();
  return promise;
}

export function cancelQueuedLaunchTasks(keyPrefix: string) {
  tasks.forEach((task, key) => {
    if (!task.started && key.startsWith(keyPrefix)) {
      tasks.delete(key);
      task.resolve(undefined);
    }
  });
}
