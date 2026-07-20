import { lazy } from 'react';

import type { AppTab } from '../shared/types';

const loaders = {
  match: () => import('./components/MatchScreen'),
  compatibility: () => import('./components/CompatibilityScreen'),
  likes: () => import('./components/LikesScreen'),
  chat: () => import('./components/ChatScreen'),
  profile: () => import('./components/ProfileScreen'),
};

export const LazyMatchScreen = lazy(loaders.match);
export const LazyCompatibilityScreen = lazy(loaders.compatibility);
export const LazyLikesScreen = lazy(loaders.likes);
export const LazyChatScreen = lazy(loaders.chat);
export const LazyProfileScreen = lazy(loaders.profile);

export function preloadTabModule(tab: AppTab) {
  if (tab === 'watch') {
    return Promise.resolve();
  }

  return loaders[tab]().then(() => undefined);
}
