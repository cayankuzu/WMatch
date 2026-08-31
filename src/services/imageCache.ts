import { Image } from 'expo-image';

/**
 * Private signed profile photos are memory-only. Clear that process cache when
 * the auth owner changes so one account cannot inherit another account's media.
 */
export async function clearPrivateImageMemoryCache() {
  await Image.clearMemoryCache();
}
