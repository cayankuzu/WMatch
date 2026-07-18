import {
  MAX_AGE,
  MAX_COMPATIBILITY_FILTER,
  MAX_DISTANCE_FILTER_KM,
  MIN_AGE,
  MIN_COMPATIBILITY_FILTER,
  MIN_DISTANCE_FILTER_KM,
} from '../constants/index.ts';

export const USER_GENDERS = ['female', 'male', 'nonbinary', 'other'] as const;
export const PUBLIC_USER_GENDERS = ['female', 'male', 'nonbinary'] as const;
export const DISCOVERY_GENDER_FILTERS = ['random', ...PUBLIC_USER_GENDERS] as const;

export type UserGender = (typeof USER_GENDERS)[number];
export type PublicUserGender = (typeof PUBLIC_USER_GENDERS)[number];
export type DiscoveryGenderFilter = (typeof DISCOVERY_GENDER_FILTERS)[number];

export interface DiscoveryPreferences {
  genderPreference: DiscoveryGenderFilter;
  ageMin: number;
  ageMax: number;
  distanceMinKm: number;
  distanceMaxKm: number;
  compatibilityMin: number;
  compatibilityMax: number;
}

export const DEFAULT_DISCOVERY_PREFERENCES: DiscoveryPreferences = {
  genderPreference: 'random',
  ageMin: MIN_AGE,
  ageMax: MAX_AGE,
  distanceMinKm: MIN_DISTANCE_FILTER_KM,
  distanceMaxKm: MAX_DISTANCE_FILTER_KM,
  compatibilityMin: MIN_COMPATIBILITY_FILTER,
  compatibilityMax: MAX_COMPATIBILITY_FILTER,
};

export function isUserGender(value: unknown): value is UserGender {
  return typeof value === 'string' && USER_GENDERS.includes(value as UserGender);
}

export function isDiscoveryGenderFilter(value: unknown): value is DiscoveryGenderFilter {
  return typeof value === 'string' && DISCOVERY_GENDER_FILTERS.includes(value as DiscoveryGenderFilter);
}

export function getUserGenderLabel(value: UserGender) {
  if (value === 'female') {
    return 'Kadın';
  }

  if (value === 'male') {
    return 'Erkek';
  }

  if (value === 'nonbinary') {
    return 'Non-binary';
  }

  return 'Diğer';
}

export function getDiscoveryGenderFilterLabel(value: DiscoveryGenderFilter) {
  if (value === 'random') {
    return 'Rastgele';
  }

  return getUserGenderLabel(value);
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeDiscoveryPreferences(
  value?: Partial<DiscoveryPreferences> | null,
): DiscoveryPreferences {
  const genderPreference = isDiscoveryGenderFilter(value?.genderPreference)
    ? value.genderPreference
    : DEFAULT_DISCOVERY_PREFERENCES.genderPreference;
  const ageMin = clampNumber(
    Number.isFinite(value?.ageMin) ? Number(value?.ageMin) : DEFAULT_DISCOVERY_PREFERENCES.ageMin,
    MIN_AGE,
    MAX_AGE,
  );
  const ageMax = clampNumber(
    Number.isFinite(value?.ageMax) ? Number(value?.ageMax) : DEFAULT_DISCOVERY_PREFERENCES.ageMax,
    MIN_AGE,
    MAX_AGE,
  );
  const distanceMinKm = clampNumber(
    Number.isFinite(value?.distanceMinKm)
      ? Number(value?.distanceMinKm)
      : DEFAULT_DISCOVERY_PREFERENCES.distanceMinKm,
    MIN_DISTANCE_FILTER_KM,
    MAX_DISTANCE_FILTER_KM,
  );
  const distanceMaxKm = clampNumber(
    Number.isFinite(value?.distanceMaxKm)
      ? Number(value?.distanceMaxKm)
      : DEFAULT_DISCOVERY_PREFERENCES.distanceMaxKm,
    MIN_DISTANCE_FILTER_KM,
    MAX_DISTANCE_FILTER_KM,
  );
  const compatibilityMin = clampNumber(
    Number.isFinite(value?.compatibilityMin)
      ? Number(value?.compatibilityMin)
      : DEFAULT_DISCOVERY_PREFERENCES.compatibilityMin,
    MIN_COMPATIBILITY_FILTER,
    MAX_COMPATIBILITY_FILTER,
  );
  const compatibilityMax = clampNumber(
    Number.isFinite(value?.compatibilityMax)
      ? Number(value?.compatibilityMax)
      : DEFAULT_DISCOVERY_PREFERENCES.compatibilityMax,
    MIN_COMPATIBILITY_FILTER,
    MAX_COMPATIBILITY_FILTER,
  );

  return {
    genderPreference,
    ageMin: Math.min(ageMin, ageMax),
    ageMax: Math.max(ageMin, ageMax),
    distanceMinKm: Math.min(distanceMinKm, distanceMaxKm),
    distanceMaxKm: Math.max(distanceMinKm, distanceMaxKm),
    compatibilityMin: Math.min(compatibilityMin, compatibilityMax),
    compatibilityMax: Math.max(compatibilityMin, compatibilityMax),
  };
}

export function hasActiveDistanceFilter(value?: Partial<DiscoveryPreferences> | null) {
  const normalized = normalizeDiscoveryPreferences(value);

  return (
    normalized.distanceMinKm > MIN_DISTANCE_FILTER_KM ||
    normalized.distanceMaxKm < MAX_DISTANCE_FILTER_KM
  );
}

export function validateDiscoveryPreferences(value: Partial<DiscoveryPreferences> | null | undefined) {
  const normalized = normalizeDiscoveryPreferences(value);

  if (!isDiscoveryGenderFilter(normalized.genderPreference)) {
    return 'Seçilen cinsiyet filtresi geçersiz.';
  }

  if (normalized.ageMin > normalized.ageMax) {
    return 'Yaş aralığı geçersiz.';
  }

  if (normalized.distanceMinKm > normalized.distanceMaxKm) {
    return 'Mesafe aralığı geçersiz.';
  }

  if (normalized.compatibilityMin > normalized.compatibilityMax) {
    return 'Uyum aralığı geçersiz.';
  }

  return null;
}

export function formatRemainingTime(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getDistanceKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371;
  const latDelta = ((right.latitude - left.latitude) * Math.PI) / 180;
  const lngDelta = ((right.longitude - left.longitude) * Math.PI) / 180;
  const startLat = (left.latitude * Math.PI) / 180;
  const endLat = (right.latitude * Math.PI) / 180;

  const haversine =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2) * Math.cos(startLat) * Math.cos(endLat);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}
