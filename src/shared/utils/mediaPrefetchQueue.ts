import { Image } from 'expo-image';

const MAX_CONCURRENT_PREFETCHES = 3;
const flights = new Map<string, Promise<boolean>>();
const queue: Array<{
  uri: string;
  resolve: (success: boolean) => void;
}> = [];
let activePrefetches = 0;

function runNext() {
  while (activePrefetches < MAX_CONCURRENT_PREFETCHES && queue.length > 0) {
    const job = queue.shift();

    if (!job) {
      return;
    }

    activePrefetches += 1;
    void Image.prefetch(job.uri)
      .then(job.resolve)
      .catch(() => job.resolve(false))
      .finally(() => {
        activePrefetches -= 1;
        flights.delete(job.uri);
        runNext();
      });
  }
}

/** Keeps speculative image traffic from saturating the device connection. */
export function scheduleMediaPrefetch(uri: string) {
  const existingFlight = flights.get(uri);
  if (existingFlight) {
    return existingFlight;
  }

  const flight = new Promise<boolean>((resolve) => {
    queue.push({ uri, resolve });
  });
  flights.set(uri, flight);
  runNext();
  return flight;
}
