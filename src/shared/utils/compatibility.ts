import { COMPATIBILITY_ALGORITHM_VERSION } from '../constants/index.ts';

export interface CompatibilityBreakdown {
  algorithmVersion: typeof COMPATIBILITY_ALGORITHM_VERSION;
  score: number;
  favoriteScore: number;
  watchedScore: number;
  commonFavoriteIds: number[];
  commonWatchedIds: number[];
  commonLibraryIds: number[];
  commonFavoriteRefs: MediaRefLike[];
  commonWatchedRefs: MediaRefLike[];
  commonLibraryRefs: MediaRefLike[];
}

export type MediaTypeLike = 'movie' | 'tv';

export interface MediaRefLike {
  id: number;
  mediaType: MediaTypeLike;
}

type MediaRefInput =
  | number
  | {
      id?: number | null;
      movie_id?: number | null;
      mediaType?: MediaTypeLike | null;
      media_type?: MediaTypeLike | null;
    };

function normalizeMediaType(value: unknown): MediaTypeLike {
  return value === 'tv' ? 'tv' : 'movie';
}

function normalizeMediaRef(input: MediaRefInput): MediaRefLike | null {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input > 0 ? { id: input, mediaType: 'movie' } : null;
  }

  const id = typeof input.id === 'number' ? input.id : input.movie_id;

  if (!Number.isInteger(id) || (id ?? 0) <= 0) {
    return null;
  }

  return {
    id: id as number,
    mediaType: normalizeMediaType(input.mediaType ?? input.media_type),
  };
}

function getMediaRefKey(ref: MediaRefLike) {
  return `${ref.mediaType}:${ref.id}`;
}

function getUniqueRefs(refs: readonly MediaRefInput[]) {
  const unique = new Map<string, MediaRefLike>();

  refs.forEach((input) => {
    const ref = normalizeMediaRef(input);

    if (ref) {
      unique.set(getMediaRefKey(ref), ref);
    }
  });

  return [...unique.values()];
}

function refsToLegacyIds(refs: MediaRefLike[]) {
  return Array.from(new Set(refs.map((ref) => ref.id)));
}

function getIntersection(left: readonly MediaRefInput[], right: readonly MediaRefInput[]) {
  const leftRefs = getUniqueRefs(left);
  const rightKeys = new Set(getUniqueRefs(right).map(getMediaRefKey));

  return leftRefs.filter((ref) => rightKeys.has(getMediaRefKey(ref)));
}

function getUnionSize(left: readonly MediaRefInput[], right: readonly MediaRefInput[]) {
  return new Set([...getUniqueRefs(left), ...getUniqueRefs(right)].map(getMediaRefKey)).size;
}

function getJaccardScore(left: readonly MediaRefInput[], right: readonly MediaRefInput[]) {
  const unionSize = getUnionSize(left, right);

  if (unionSize === 0) {
    return null;
  }

  return getIntersection(left, right).length / unionSize;
}

export function getCompatibilityBreakdown(
  favoritesA: readonly MediaRefInput[],
  watchedA: readonly MediaRefInput[],
  favoritesB: readonly MediaRefInput[],
  watchedB: readonly MediaRefInput[],
): CompatibilityBreakdown {
  const commonFavoriteRefs = getIntersection(favoritesA, favoritesB);
  const commonWatchedRefs = getIntersection(watchedA, watchedB);
  const commonLibraryRefs = [...new Map(
    [...commonFavoriteRefs, ...commonWatchedRefs].map((ref) => [getMediaRefKey(ref), ref]),
  ).values()];

  const favoriteScore = getJaccardScore(favoritesA, favoritesB);
  const watchedScore = getJaccardScore(watchedA, watchedB);

  const activeWeights = [
    favoriteScore != null ? { weight: 0.65, value: favoriteScore } : null,
    watchedScore != null ? { weight: 0.35, value: watchedScore } : null,
  ].filter((item): item is { weight: number; value: number } => item != null);

  const weightedTotal = activeWeights.reduce((sum, item) => sum + item.weight, 0);
  const normalizedScore =
    weightedTotal === 0
      ? 0
      : activeWeights.reduce((sum, item) => sum + item.value * item.weight, 0) / weightedTotal;

  return {
    algorithmVersion: COMPATIBILITY_ALGORITHM_VERSION,
    score: Math.round(normalizedScore * 100),
    favoriteScore: Math.round((favoriteScore ?? 0) * 100),
    watchedScore: Math.round((watchedScore ?? 0) * 100),
    commonFavoriteIds: refsToLegacyIds(commonFavoriteRefs),
    commonWatchedIds: refsToLegacyIds(commonWatchedRefs),
    commonLibraryIds: refsToLegacyIds(commonLibraryRefs),
    commonFavoriteRefs,
    commonWatchedRefs,
    commonLibraryRefs,
  };
}

export function calculateCompatibilityScore(
  favoritesA: readonly MediaRefInput[],
  watchedA: readonly MediaRefInput[],
  favoritesB: readonly MediaRefInput[],
  watchedB: readonly MediaRefInput[],
): number {
  return getCompatibilityBreakdown(favoritesA, watchedA, favoritesB, watchedB).score;
}
