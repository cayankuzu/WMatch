import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'wmatch:recent-searches:';
const MAX_RECENT_SEARCHES = 5;

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export async function loadRecentSearches(userId: string) {
  try {
    const value = await AsyncStorage.getItem(storageKey(userId));
    const parsed = value ? JSON.parse(value) as unknown : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch {
    return [];
  }
}

export async function saveRecentSearch(userId: string, query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return loadRecentSearches(userId);
  }

  const current = await loadRecentSearches(userId);
  const normalizedLower = normalizedQuery.toLocaleLowerCase('tr-TR');
  const next = [
    normalizedQuery,
    ...current.filter((item) => item.toLocaleLowerCase('tr-TR') !== normalizedLower),
  ].slice(0, MAX_RECENT_SEARCHES);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  return next;
}

export async function clearRecentSearches(userId: string) {
  await AsyncStorage.removeItem(storageKey(userId));
}
