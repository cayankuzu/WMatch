import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserSessionStorageKeys } from '../constants/storage';

const sessionCacheCleaners = new Set<() => void>();

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

  await AsyncStorage.multiRemove(getUserSessionStorageKeys(userId));
}
