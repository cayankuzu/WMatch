import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE, fetchWithRetry } from '../../utils/supabase/client';
import { publicAnonKey } from '../../utils/supabase/info';
import type { MediaRef, MediaType } from '../shared/types';
import {
  scheduleMediaPrefetch,
  type MediaPrefetchPriority,
} from '../shared/utils/mediaPrefetchQueue';

const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';
const EMPTY_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const FALLBACK_POSTER = EMPTY_IMAGE;
const FALLBACK_BACKDROP = EMPTY_IMAGE;
const CACHE_TTL_MS = 30 * 60 * 1000;
const PERSISTENT_CACHE_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESPONSE_CACHE_ENTRIES = 220;
const MAX_PERSISTENT_CACHE_ENTRIES = 64;
const MAX_PREFETCHED_IMAGES = 160;
const MAX_IMAGE_PREFETCH_PER_CALL = 12;
const MEDIA_LOOKUP_BATCH_SIZE = 8;
const PERSISTENT_CACHE_KEY_PREFIX = 'wmatch:tmdb-response:';
const responseCache = new Map<string, { value: unknown; expiresAt: number; staleUntil: number }>();
const inflightRequests = new Map<string, Promise<unknown>>();
const prefetchedImages = new Set<string>();
const persistentCacheKeys = new Map<string, number>();
let persistentCacheMaintenancePromise: Promise<void> | null = null;
let persistentCacheMutation = Promise.resolve();

export interface Genre {
  id: number;
  name: string;
}

export interface Movie {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  media_type?: 'movie' | 'tv';
  genres?: Genre[];
  genre_ids?: number[];
}

export interface TMDBResponse {
  page: number;
  results: Movie[];
  total_pages: number;
  total_results: number;
}

type TMDBPayload = Record<string, unknown>;
type PosterSize = 'w200' | 'w500' | 'original';
type BackdropSize = 'w500' | 'original';
type MediaKind = MediaType;
type SearchKind = 'multi' | 'movie' | 'tv';

interface TMDBTranslationData {
  overview?: string;
}

interface TMDBTranslationPayload {
  iso_639_1?: string;
  data?: TMDBTranslationData;
}

interface TMDBTranslationsResponse {
  translations?: TMDBTranslationPayload[];
}

interface PersistentCacheEntry {
  value: unknown;
  expiresAt: number;
  storedAt: number;
}

interface TMDBBatchResponse {
  items: Array<{
    id: number;
    mediaType: MediaKind;
    payload: TMDBPayload | null;
  }>;
}

function getPersistentCacheKey(path: string) {
  return `${PERSISTENT_CACHE_KEY_PREFIX}${encodeURIComponent(path)}`;
}

function initializePersistentCache() {
  if (persistentCacheMaintenancePromise) {
    return persistentCacheMaintenancePromise;
  }

  persistentCacheMaintenancePromise = (async () => {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter((key) => key.startsWith(PERSISTENT_CACHE_KEY_PREFIX));
    const entries = await AsyncStorage.multiGet(cacheKeys);
    const now = Date.now();
    const validEntries: Array<{ key: string; storedAt: number }> = [];
    const keysToRemove: string[] = [];

    entries.forEach(([key, rawValue]) => {
      try {
        const entry = rawValue ? JSON.parse(rawValue) as Partial<PersistentCacheEntry> : null;
        const storedAt = Number(entry?.storedAt);

        if (!entry || !Number.isFinite(storedAt) || now - storedAt > PERSISTENT_CACHE_STALE_TTL_MS) {
          keysToRemove.push(key);
          return;
        }

        validEntries.push({ key, storedAt });
      } catch {
        keysToRemove.push(key);
      }
    });

    validEntries.sort((left, right) => right.storedAt - left.storedAt);
    validEntries.slice(MAX_PERSISTENT_CACHE_ENTRIES).forEach(({ key }) => keysToRemove.push(key));
    validEntries
      .slice(0, MAX_PERSISTENT_CACHE_ENTRIES)
      .reverse()
      .forEach(({ key, storedAt }) => persistentCacheKeys.set(key, storedAt));

    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove([...new Set(keysToRemove)]);
    }
  })().catch((error) => {
    console.warn('TMDB persistent cache maintenance failed:', error);
  });

  return persistentCacheMaintenancePromise;
}

function putMemoryCache(
  path: string,
  value: unknown,
  expiresAt = Date.now() + CACHE_TTL_MS,
  staleUntil = Date.now() + PERSISTENT_CACHE_STALE_TTL_MS,
) {
  responseCache.set(path, { value, expiresAt, staleUntil });

  while (responseCache.size > MAX_RESPONSE_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;

    if (!oldestKey) {
      break;
    }

    responseCache.delete(oldestKey);
  }
}

async function readPersistentCache(path: string) {
  try {
    // Read the requested entry directly; full-cache pruning starts only after
    // first content when the next network response is persisted.
    const cacheKey = getPersistentCacheKey(path);
    const rawValue = await AsyncStorage.getItem(cacheKey);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<PersistentCacheEntry>;

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      !Number.isFinite(parsedValue.expiresAt) ||
      parsedValue.value == null
    ) {
      persistentCacheKeys.delete(cacheKey);
      await AsyncStorage.removeItem(cacheKey);
      return null;
    }

    if (!Number.isFinite(parsedValue.storedAt) || Date.now() - Number(parsedValue.storedAt) > PERSISTENT_CACHE_STALE_TTL_MS) {
      persistentCacheKeys.delete(cacheKey);
      await AsyncStorage.removeItem(cacheKey);
      return null;
    }

    persistentCacheKeys.delete(cacheKey);
    persistentCacheKeys.set(cacheKey, Number(parsedValue.storedAt));

    return {
      value: parsedValue.value,
      expiresAt: Number(parsedValue.expiresAt),
      staleUntil: Number(parsedValue.storedAt) + PERSISTENT_CACHE_STALE_TTL_MS,
      isFresh: Number(parsedValue.expiresAt) > Date.now(),
    };
  } catch (error) {
    console.warn('TMDB persistent cache read failed:', error);
    return null;
  }
}

async function writePersistentCache(path: string, value: unknown) {
  try {
    await initializePersistentCache();
    const cacheKey = getPersistentCacheKey(path);
    const entry: PersistentCacheEntry = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
      storedAt: Date.now(),
    };

    persistentCacheMutation = persistentCacheMutation.then(async () => {
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
      persistentCacheKeys.delete(cacheKey);
      persistentCacheKeys.set(cacheKey, entry.storedAt);

      const keysToRemove: string[] = [];

      while (persistentCacheKeys.size > MAX_PERSISTENT_CACHE_ENTRIES) {
        const oldestKey = persistentCacheKeys.keys().next().value;

        if (!oldestKey) {
          break;
        }

        persistentCacheKeys.delete(oldestKey);
        keysToRemove.push(oldestKey);
      }

      if (keysToRemove.length > 0) {
        await AsyncStorage.multiRemove(keysToRemove);
      }
    });

    await persistentCacheMutation;
  } catch (error) {
    console.warn('TMDB persistent cache write failed:', error);
  }
}

function requestTMDB<T>(path: string, signal?: AbortSignal): Promise<T> {
  const inflightRequest = signal ? null : inflightRequests.get(path);
  if (inflightRequest) {
    return inflightRequest as Promise<T>;
  }

  const request = fetchWithRetry(`${API_BASE}/tmdb${path}`, {
    signal,
    headers: {
      Authorization: `Bearer ${publicAnonKey}`,
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`TMDB request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as T;
      putMemoryCache(path, payload);
      void writePersistentCache(path, payload);

      return payload;
    })
    .finally(() => {
      if (!signal) {
        inflightRequests.delete(path);
      }
    });

  if (!signal) {
    inflightRequests.set(path, request as Promise<unknown>);
  }
  return request;
}

function revalidateTMDB(path: string) {
  void requestTMDB(path).catch((error) => {
    console.warn('TMDB background refresh failed; keeping cached payload:', error);
  });
}

async function fetchTMDB<T>(path: string, signal?: AbortSignal): Promise<T> {
  const cached = responseCache.get(path);

  if (cached) {
    if (cached.staleUntil <= Date.now()) {
      responseCache.delete(path);
    } else {
      responseCache.delete(path);
      responseCache.set(path, cached);

      if (cached.expiresAt <= Date.now()) {
        revalidateTMDB(path);
      }

      return cached.value as T;
    }
  }

  const persistentCache = await readPersistentCache(path);

  if (persistentCache) {
    putMemoryCache(
      path,
      persistentCache.value,
      persistentCache.expiresAt,
      persistentCache.staleUntil,
    );

    if (!persistentCache.isFresh) {
      revalidateTMDB(path);
    }

    return persistentCache.value as T;
  }

  return requestTMDB<T>(path, signal);
}

function normalizeMovie(payload: TMDBPayload, fallbackType?: 'movie' | 'tv'): Movie {
  const mediaType =
    payload.media_type === 'movie' || payload.media_type === 'tv'
      ? (payload.media_type as 'movie' | 'tv')
      : fallbackType;

  return {
    id: Number(payload.id),
    title: typeof payload.title === 'string' ? payload.title : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    poster_path: typeof payload.poster_path === 'string' ? payload.poster_path : null,
    backdrop_path: typeof payload.backdrop_path === 'string' ? payload.backdrop_path : null,
    vote_average: typeof payload.vote_average === 'number' ? payload.vote_average : 0,
    release_date: typeof payload.release_date === 'string' ? payload.release_date : undefined,
    first_air_date: typeof payload.first_air_date === 'string' ? payload.first_air_date : undefined,
    overview: typeof payload.overview === 'string' ? payload.overview : undefined,
    media_type: mediaType,
    genres: Array.isArray(payload.genres) ? (payload.genres as Genre[]) : undefined,
    genre_ids: Array.isArray(payload.genre_ids) ? (payload.genre_ids as number[]) : undefined,
  };
}

function normalizeResponse(
  payload: Omit<TMDBResponse, 'results'> & { results: TMDBPayload[] },
  fallbackType?: 'movie' | 'tv',
): TMDBResponse {
  return {
    ...payload,
    results: payload.results.map((item) => normalizeMovie(item, fallbackType)),
  };
}

export function getMediaRefKey(ref: { id: number; mediaType?: MediaType | null }) {
  return `${ref.mediaType ?? 'movie'}:${ref.id}`;
}

export function getMovieKey(movie: Movie) {
  return getMediaRefKey({
    id: movie.id,
    mediaType: movie.media_type === 'tv' ? 'tv' : 'movie',
  });
}

export function movieToMediaRef(movie: Movie): MediaRef {
  return {
    id: movie.id,
    mediaType: movie.media_type === 'tv' ? 'tv' : 'movie',
  };
}

export function legacyMovieIdsToRefs(ids: number[]): MediaRef[] {
  return ids
    .filter((id) => Number.isInteger(id) && id > 0)
    .map((id) => ({ id, mediaType: 'movie' as const }));
}

function mergeSearchResponses(...responses: TMDBResponse[]) {
  const seen = new Set<string>();
  const mergedResults: Movie[] = [];

  responses.forEach((response) => {
    response.results.forEach((movie) => {
      const key = getMovieKey(movie);

      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      mergedResults.push(movie);
    });
  });

  return {
    page: responses[0]?.page ?? 1,
    total_pages: Math.max(...responses.map((response) => response.total_pages), 1),
    total_results: mergedResults.length,
    results: mergedResults,
  };
}

async function safeFetchResponse(
  path: string,
  fallbackType?: 'movie' | 'tv',
  signal?: AbortSignal,
): Promise<TMDBResponse> {
  const payload = await fetchTMDB<Omit<TMDBResponse, 'results'> & { results: TMDBPayload[] }>(path, signal);
  return normalizeResponse(payload, fallbackType);
}

async function searchWithLanguageFallback(
  kind: SearchKind,
  query: string,
  page = 1,
  fallbackType?: 'movie' | 'tv',
  signal?: AbortSignal,
): Promise<TMDBResponse> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return {
      page: 1,
      results: [],
      total_pages: 1,
      total_results: 0,
    };
  }

  const localizedResponse = await safeFetchResponse(
    `/search/${kind}?language=tr-TR&query=${encodeURIComponent(normalizedQuery)}&page=${page}`,
    fallbackType,
    signal,
  );

  if (localizedResponse.results.length >= 8) {
    return localizedResponse;
  }

  const [originalResponse, englishResponse] = await Promise.all([
    safeFetchResponse(
      `/search/${kind}?query=${encodeURIComponent(normalizedQuery)}&page=${page}`,
      fallbackType,
      signal,
    ),
    safeFetchResponse(
      `/search/${kind}?language=en-US&query=${encodeURIComponent(normalizedQuery)}&page=${page}`,
      fallbackType,
      signal,
    ),
  ]);

  return mergeSearchResponses(localizedResponse, originalResponse, englishResponse);
}

function mergeMovieDetails(
  primary: Movie,
  fallback: Movie,
  options?: { keepPrimaryOverviewOnly?: boolean },
): Movie {
  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    name: primary.name || fallback.name,
    poster_path: primary.poster_path || fallback.poster_path,
    backdrop_path: primary.backdrop_path || fallback.backdrop_path,
    overview: options?.keepPrimaryOverviewOnly
      ? primary.overview?.trim()
      : primary.overview?.trim() || fallback.overview?.trim(),
    genres: primary.genres?.length ? primary.genres : fallback.genres,
    genre_ids: primary.genre_ids?.length ? primary.genre_ids : fallback.genre_ids,
  };
}

async function fetchTurkishOverview(kind: MediaKind, id: number): Promise<string | undefined> {
  try {
    const payload = await fetchTMDB<TMDBTranslationsResponse>(`/${kind}/${id}/translations`);
    return payload.translations
      ?.find((translation) => translation.iso_639_1 === 'tr' && translation.data?.overview?.trim())
      ?.data?.overview?.trim();
  } catch (error) {
    console.error('TMDB Turkish overview lookup error:', error);
    return undefined;
  }
}

async function fetchDetailsWithFallback(kind: MediaKind, id: number): Promise<Movie> {
  const basePath = `/${kind}/${id}`;
  const [localizedPayload, turkishOverview] = await Promise.all([
    fetchTMDB<TMDBPayload>(`${basePath}?language=tr-TR`),
    fetchTurkishOverview(kind, id),
  ]);
  const localizedMovie = {
    ...normalizeMovie(localizedPayload, kind),
    overview: turkishOverview,
  };

  if (turkishOverview) {
    return localizedMovie;
  }

  try {
    const originalPayload = await fetchTMDB<TMDBPayload>(basePath);
    const originalMovie = normalizeMovie(originalPayload, kind);
    return mergeMovieDetails(localizedMovie, originalMovie, { keepPrimaryOverviewOnly: true });
  } catch (error) {
    console.error('TMDB original details fallback error:', error);
    return localizedMovie;
  }
}

async function fetchMediaBatch(refs: Array<{ id: number; mediaType: MediaKind }>) {
  const response = await fetchWithRetry(`${API_BASE}/tmdb/media-batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${publicAnonKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `tmdb-batch:${refs.map((ref) => `${ref.mediaType}:${ref.id}`).join(',')}`,
    },
    body: JSON.stringify({ refs }),
  });

  if (!response.ok) {
    throw new Error(`TMDB batch request failed with status ${response.status}`);
  }

  const data = await response.json() as TMDBBatchResponse;
  const movies = new Map<string, Movie>();

  data.items.forEach((item) => {
    if (!item.payload) {
      return;
    }

    const path = `/${item.mediaType}/${item.id}?language=tr-TR`;
    putMemoryCache(path, item.payload);
    void writePersistentCache(path, item.payload);
    movies.set(getMediaRefKey(item), normalizeMovie(item.payload, item.mediaType));
  });

  return movies;
}

async function prefetchImages(urls: string[], priority: MediaPrefetchPriority) {
  const nextUrls = Array.from(new Set(urls.filter((url) => url && url !== EMPTY_IMAGE))).filter(
    (url) => !prefetchedImages.has(url),
  ).slice(0, MAX_IMAGE_PREFETCH_PER_CALL);

  await Promise.allSettled(
    nextUrls.map(async (url) => {
      const success = await scheduleMediaPrefetch(url, priority, 'tmdb-artwork');
      if (success) {
        prefetchedImages.add(url);

        while (prefetchedImages.size > MAX_PREFETCHED_IMAGES) {
          const oldestUrl = prefetchedImages.values().next().value;

          if (!oldestUrl) {
            break;
          }

          prefetchedImages.delete(oldestUrl);
        }
      }
    }),
  );
}

export const tmdbService = {
  getPosterUrl(path: string | null, size: PosterSize = 'w500') {
    return path ? `${IMAGE_BASE_URL}/${size}${path}` : FALLBACK_POSTER;
  },

  getBackdropUrl(path: string | null, size: BackdropSize = 'original') {
    return path ? `${IMAGE_BASE_URL}/${size}${path}` : FALLBACK_BACKDROP;
  },

  getTrending(page = 1) {
    return safeFetchResponse(`/trending/all/week?language=tr-TR&page=${page}`);
  },

  getPopularMovies(page = 1) {
    return safeFetchResponse(`/movie/popular?language=tr-TR&page=${page}`, 'movie');
  },

  getPopularTVShows(page = 1) {
    return safeFetchResponse(`/tv/popular?language=tr-TR&page=${page}`, 'tv');
  },

  searchMulti(query: string, page = 1, signal?: AbortSignal) {
    return searchWithLanguageFallback('multi', query, page, undefined, signal);
  },

  searchMovies(query: string, page = 1, signal?: AbortSignal) {
    return searchWithLanguageFallback('movie', query, page, 'movie', signal);
  },

  searchTVShows(query: string, page = 1, signal?: AbortSignal) {
    return searchWithLanguageFallback('tv', query, page, 'tv', signal);
  },

  async getMovieDetails(id: number): Promise<Movie> {
    return fetchDetailsWithFallback('movie', id);
  },

  async getTVDetails(id: number): Promise<Movie> {
    return fetchDetailsWithFallback('tv', id);
  },

  async getMediaById(id: number): Promise<Movie | null> {
    let movieError: unknown = null;

    try {
      return await this.getMovieDetails(id);
    } catch (error) {
      movieError = error;
      try {
        return await this.getTVDetails(id);
      } catch (error) {
        console.error('TMDB media lookup error:', error);
        const movieMissing = movieError instanceof Error && /status 404\b/.test(movieError.message);
        const tvMissing = error instanceof Error && /status 404\b/.test(error.message);

        if (movieMissing && tvMissing) {
          return null;
        }

        throw error;
      }
    }
  },

  async getMediaByRef(ref: MediaRef | { id: number; mediaType?: MediaKind | null }): Promise<Movie | null> {
    try {
      if (ref.mediaType === 'tv') {
        return await this.getTVDetails(ref.id);
      }

      if (ref.mediaType === 'movie') {
        return await this.getMovieDetails(ref.id);
      }

      return await this.getMediaById(ref.id);
    } catch (error) {
      console.error('TMDB typed media lookup error:', error);
      throw error;
    }
  },

  async getMediaListByIds(ids: number[]): Promise<Movie[]> {
    return this.getMediaListByRefs(ids.map((id) => ({ id, mediaType: 'movie' as const })));
  },

  async getMediaListByRefs(refs: Array<MediaRef | { id: number; mediaType?: MediaKind | null }>): Promise<Movie[]> {
    const resolved: Array<Movie | null> = [];

    for (let index = 0; index < refs.length; index += MEDIA_LOOKUP_BATCH_SIZE) {
      const batch = refs.slice(index, index + MEDIA_LOOKUP_BATCH_SIZE);
      const typedBatch = batch.map((ref) => ({ id: ref.id, mediaType: ref.mediaType ?? 'movie' }));

      try {
        const batchMovies = await fetchMediaBatch(typedBatch);
        const batchResolved = typedBatch.map((ref) => batchMovies.get(getMediaRefKey(ref)) ?? null);
        const missingIndexes = batchResolved
          .map((movie, batchIndex) => movie ? -1 : batchIndex)
          .filter((batchIndex) => batchIndex >= 0);

        if (missingIndexes.length > 0) {
          const fallbacks = await Promise.all(
            missingIndexes.map((batchIndex) => this.getMediaByRef(typedBatch[batchIndex])),
          );
          fallbacks.forEach((movie, fallbackIndex) => {
            batchResolved[missingIndexes[fallbackIndex]] = movie;
          });
        }

        resolved.push(...batchResolved);
      } catch {
        resolved.push(...(await Promise.all(batch.map((ref) => this.getMediaByRef(ref)))));
      }
    }

    return resolved.filter((movie): movie is Movie => movie != null);
  },

  async prefetchMovieArtwork(
    movies: Array<Movie | null | undefined>,
    options?: {
      includeBackdrop?: boolean;
      posterSize?: PosterSize;
      backdropSize?: BackdropSize;
      priority?: MediaPrefetchPriority;
    },
  ) {
    const posterSize = options?.posterSize ?? 'w200';
    const backdropSize = options?.backdropSize ?? 'w500';
    const safeMovies = movies.filter((movie): movie is Movie => movie != null);
    const urls = safeMovies.flatMap((movie) => {
      const movieUrls = [this.getPosterUrl(movie.poster_path, posterSize)];

      if (options?.includeBackdrop) {
        movieUrls.push(this.getBackdropUrl(movie.backdrop_path ?? movie.poster_path ?? null, backdropSize));
      }

      return movieUrls;
    });

    await prefetchImages(urls, options?.priority ?? 'predictive');
  },
};
