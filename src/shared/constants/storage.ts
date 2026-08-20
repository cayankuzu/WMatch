const userKey = (prefix: string, userId: string) => `${prefix}${userId}`;

const prefixes = {
  pausedWatching: 'wmatch:paused-watching:',
  movieSyncOutbox: 'wmatch:movie-sync-outbox:',
  librarySnapshot: 'wmatch:library-snapshot:',
  swipeQuota: 'wmatch:swipe-quota:',
  tabUsage: 'wmatch:tab-history:',
  recentSearches: 'wmatch:recent-searches:',
  screenState: 'wmatch:screen-state:v1:',
} as const;

export const storageKeys = {
  pausedWatching: (userId: string) => userKey(prefixes.pausedWatching, userId),
  movieSyncOutbox: (userId: string) => userKey(prefixes.movieSyncOutbox, userId),
  librarySnapshot: (userId: string) => userKey(prefixes.librarySnapshot, userId),
  swipeQuota: (userId: string) => userKey(prefixes.swipeQuota, userId),
  tabUsage: (userId: string) => userKey(prefixes.tabUsage, userId),
  recentSearches: (userId: string) => userKey(prefixes.recentSearches, userId),
  screenState: (userId: string, screen: 'chat' | 'likes') => (
    `${prefixes.screenState}${userId}:${screen}`
  ),
} as const;

export function getUserSessionStorageKeys(userId: string) {
  return [
    storageKeys.pausedWatching(userId),
    storageKeys.movieSyncOutbox(userId),
    storageKeys.librarySnapshot(userId),
    storageKeys.swipeQuota(userId),
    storageKeys.tabUsage(userId),
    storageKeys.recentSearches(userId),
    storageKeys.screenState(userId, 'chat'),
    storageKeys.screenState(userId, 'likes'),
  ];
}
