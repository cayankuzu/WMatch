import { useEffect } from 'react';

import { preloadChatList } from '../../services/chatCache';
import { hydrateScreenSessionState } from '../../services/screenSessionState';
import {
  cancelQueuedLaunchTasks,
  scheduleLaunchTask,
  type LaunchTaskPriority,
} from '../../services/launchScheduler';
import { loadTabWarmupOrder } from '../../services/tabUsage';
import { telemetry } from '../../services/telemetry';
import type { AppTab, AppUser } from '../../shared/types';
import { getAppState, subscribeToForeground } from '../../shared/utils/appLifecycle';
import { preloadDiscoveryData } from './useDiscoveryData';
import { preloadSwipeQuota } from './useSwipeQuota';

const FIRST_USEFUL_CONTENT_GRACE_MS = 450;

function waitForIdle() {
  return new Promise<void>((resolve) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 900 });
      return;
    }

    setTimeout(resolve, 32);
  });
}

async function preloadTabResources(userId: string, tab: AppTab) {
  if (tab === 'match') {
    await Promise.all([
      preloadDiscoveryData('watch', userId),
      preloadSwipeQuota(userId),
    ]);
    return;
  }

  if (tab === 'chat') {
    await Promise.all([
      preloadChatList(userId),
      hydrateScreenSessionState(userId, 'chat'),
    ]);
    return;
  }

  if (tab === 'likes') {
    await Promise.all([
      preloadDiscoveryData('likes', userId),
      preloadSwipeQuota(userId),
      hydrateScreenSessionState(userId, 'likes'),
    ]);
    return;
  }

  if (tab === 'compatibility') {
    await Promise.all([
      preloadDiscoveryData('compatibility', userId),
      preloadSwipeQuota(userId),
    ]);
    return;
  }
}

export function preloadTabData(
  userId: string,
  tab: AppTab,
  priority: LaunchTaskPriority = 'intent',
) {
  return scheduleLaunchTask({
    key: `tab:${userId}:${tab}`,
    priority,
    run: () => preloadTabResources(userId, tab),
  });
}

export default function useAppDataWarmup(user: AppUser | null, currentTab: AppTab) {
  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      return;
    }

    let cancelled = false;
    let running = false;

    const run = async () => {
      if (running || cancelled || getAppState() !== 'active') {
        return;
      }

      running = true;
      try {
        const warmupOrder = await loadTabWarmupOrder(userId, currentTab);

        for (const tab of warmupOrder) {
          await waitForIdle();
          if (cancelled || getAppState() !== 'active') {
            break;
          }

          const span = telemetry.startSpan('app.data_warmup');
          try {
            await preloadTabData(userId, tab, 'idle');
            span.end({ tab, outcome: 'success' });
          } catch (error) {
            span.end({ tab, outcome: 'error' });
            telemetry.captureException(error, { operation: 'background_screen_warmup', tab });
          }
        }

        if (!cancelled) {
          telemetry.markStartupMilestone('background_warmup_ready');
        }
      } catch (error) {
        telemetry.captureException(error, { operation: 'background_warmup_order' });
      } finally {
        running = false;
      }
    };

    const startTimer = setTimeout(() => void run(), FIRST_USEFUL_CONTENT_GRACE_MS);
    const unsubscribeForeground = subscribeToForeground(() => void run());

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      cancelQueuedLaunchTasks(`tab:${userId}:`);
      unsubscribeForeground();
    };
  }, [currentTab, user?.id]);
}
