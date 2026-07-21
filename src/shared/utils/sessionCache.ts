import AsyncStorage from '@react-native-async-storage/async-storage';

const sessionCacheCleaners = new Set<() => void>();
const USER_SESSION_STORAGE_PREFIXES = [
  'wmatch:paused-watching:',
  'wmatch:movie-sync-outbox:',
  'wmatch:library-snapshot:',
  'wmatch:swipe-quota:',
  'wmatch:tab-history:',
  'wmatch:recent-searches:',
] as const;

export function registerSessionCache(cleaner: () => void) {
  sessionCacheCleaners.add(cleaner);
  return () => sessionCacheCleaners.delete(cleaner);
}

export function clearSessionCaches() {
  sessionCacheCleaners.forEach((cleaner) => cleaner());
}

export async function purgeUserSessionStorage(userId: string | null | undefined) {
  if (!userId) {
    return;
  }

  await AsyncStorage.multiRemove(
    USER_SESSION_STORAGE_PREFIXES.map((prefix) => `${prefix}${userId}`),
  );
}
