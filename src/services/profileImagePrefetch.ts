import { BoundedMap } from '../shared/utils/boundedMap';
import { scheduleMediaPrefetch } from '../shared/utils/mediaPrefetchQueue';
import { registerSessionCache } from '../shared/utils/sessionCache';

const completedPrefetches = new BoundedMap<string, true>(128);
const prefetchFlights = new BoundedMap<string, Promise<void>>(32);
let prefetchGeneration = 0;

registerSessionCache(() => {
  prefetchGeneration += 1;
  completedPrefetches.clear();
  prefetchFlights.clear();
});

function getFirstRemotePhoto(photos: string[]) {
  return photos.find((photo) => /^https:\/\//i.test(photo.trim()))?.trim() ?? null;
}

export async function prefetchProfilePhotos(
  photoGroups: string[][],
  limit = 4,
) {
  const uris = [...new Set(photoGroups.map(getFirstRemotePhoto).filter((uri): uri is string => Boolean(uri)))]
    .slice(0, limit);

  await Promise.allSettled(
    uris.map(async (uri) => {
      if (completedPrefetches.has(uri)) {
        return;
      }

      const existingFlight = prefetchFlights.get(uri);
      if (existingFlight) {
        return existingFlight;
      }

      const requestGeneration = prefetchGeneration;
      const flight = scheduleMediaPrefetch(uri)
        .then((success) => {
          if (success && requestGeneration === prefetchGeneration) {
            completedPrefetches.set(uri, true);
          }
        })
        .finally(() => {
          if (prefetchFlights.get(uri) === flight) {
            prefetchFlights.delete(uri);
          }
        });

      prefetchFlights.set(uri, flight);
      return flight;
    }),
  );
}
