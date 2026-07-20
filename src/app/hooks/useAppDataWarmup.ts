import { useEffect } from 'react';

import { preloadChatList, preloadChatThread } from '../../services/chatCache';
import {
  cancelQueuedLaunchTasks,
  scheduleLaunchTask,
  type LaunchTaskPriority,
} from '../../services/launchScheduler';
import { prefetchProfilePhotos } from '../../services/profileImagePrefetch';
import { loadTabWarmupOrder } from '../../services/tabUsage';
import { telemetry } from '../../services/telemetry';
import type { AppTab, AppUser } from '../../shared/types';
import { getAppState, subscribeToForeground } from '../../shared/utils/appLifecycle';
import { preloadDiscoveryData } from './useDiscoveryData';
import { preloadSwipeQuota } from './useSwipeQuota';

const FIRST_FRAME_GRACE_MS = 250;

function waitForIdle() {
  return new Promise<void>((resolve) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 900 });
      return;
    }

    setTimeout(resolve, 32);
  });
}

async function preloadTabResources(user: AppUser, tab: AppTab) {
  if (tab === 'match') {
    await preloadDiscoveryData('watch', user.id);
    await preloadSwipeQuota(user.id);
    return;
  }

  if (tab === 'chat') {
    const { chats } = await preloadChatList(user.id);
    for (const chat of chats.slice(0, 1)) {
      await preloadChatThread(user.id, chat.userId);
    }
    return;
  }

  if (tab === 'likes') {
    await preloadDiscoveryData('likes', user.id);
    await preloadSwipeQuota(user.id);
    return;
  }

  if (tab === 'compatibility') {
    await preloadDiscoveryData('compatibility', user.id);
    await preloadSwipeQuota(user.id);
    return;
  }

  if (tab === 'profile') {
    await prefetchProfilePhotos([user.photos], 2, 'predictive');
  }
}

export function preloadTabData(
  user: AppUser,
  tab: AppTab,
  priority: LaunchTaskPriority = 'intent',
) {
  return scheduleLaunchTask({
    key: `tab:${user.id}:${tab}`,
    priority,
    run: () => preloadTabResources(user, tab),
  });
}

export default function useAppDataWarmup(user: AppUser | null, currentTab: AppTab) {
  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    let running = false;

    const run = async () => {
      if (running || cancelled || getAppState() !== 'active') {
        return;
      }

      running = true;
      const warmupOrder = await loadTabWarmupOrder(user.id, currentTab);

      for (const tab of warmupOrder) {
        await waitForIdle();
        if (cancelled || getAppState() !== 'active') {
          break;
        }

        const span = telemetry.startSpan('app.data_warmup');
        try {
          await preloadTabData(user, tab, 'predictive');
          span.end({ tab, outcome: 'success' });
        } catch (error) {
          span.end({ tab, outcome: 'error' });
          console.warn('Background screen warmup failed', {
            tab,
            message: error instanceof Error ? error.message : 'Unknown warmup error',
          });
        }
      }

      running = false;
      if (!cancelled) {
        telemetry.markStartupMilestone('background_warmup_ready');
      }
    };

    const startTimer = setTimeout(() => void run(), FIRST_FRAME_GRACE_MS);
    const unsubscribeForeground = subscribeToForeground(() => void run());

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      cancelQueuedLaunchTasks(`tab:${user.id}:`);
      unsubscribeForeground();
    };
  }, [currentTab, user]);
}
