import { useEffect } from 'react';
import { AppState } from 'react-native';

import { preloadChatList, preloadChatThread } from '../../services/chatCache';
import { prefetchProfilePhotos } from '../../services/profileImagePrefetch';
import { telemetry } from '../../services/telemetry';
import type { AppTab, AppUser } from '../../shared/types';
import { preloadDiscoveryData } from './useDiscoveryData';
import { preloadSwipeQuota } from './useSwipeQuota';

const WARMUP_ORDER: AppTab[] = [
  'match',
  'chat',
  'likes',
  'compatibility',
  'profile',
];
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

function isInBackground() {
  return AppState.currentState === 'background';
}

export async function preloadTabData(user: AppUser, tab: AppTab) {
  if (tab === 'match') {
    await preloadDiscoveryData('watch', user.id);
    await preloadSwipeQuota(user.id);
    return;
  }

  if (tab === 'chat') {
    const { chats } = await preloadChatList(user.id);
    for (const chat of chats.slice(0, 2)) {
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
    await prefetchProfilePhotos([user.photos], user.photos.length);
  }
}

export default function useAppDataWarmup(user: AppUser | null) {
  useEffect(() => {
    if (!user) {
      return;
    }

    let cancelled = false;
    let nextIndex = 0;
    let running = false;

    const run = async () => {
      if (running || cancelled || isInBackground()) {
        return;
      }

      running = true;
      while (!cancelled && !isInBackground() && nextIndex < WARMUP_ORDER.length) {
        await waitForIdle();
        if (cancelled || isInBackground()) {
          break;
        }

        const tab = WARMUP_ORDER[nextIndex++];
        const span = telemetry.startSpan('app.data_warmup');
        try {
          await preloadTabData(user, tab);
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
      if (!cancelled && nextIndex >= WARMUP_ORDER.length) {
        telemetry.markStartupMilestone('background_warmup_ready');
      }
    };

    const startTimer = setTimeout(() => void run(), FIRST_FRAME_GRACE_MS);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void run();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      appStateSubscription.remove();
    };
  }, [user]);
}
