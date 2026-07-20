import {
  MAX_AGE,
  MAX_BIO_LENGTH,
  MAX_LETTERBOXD_LENGTH,
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  MIN_AGE,
  MIN_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '../constants/index.ts';
import { isUserGender, type UserGender } from './discovery.ts';

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeBio(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

export function countMessageCharacters(value: string) {
  return Array.from(value).length;
}

export function clampMessageText(value: string) {
  return Array.from(value).slice(0, MAX_MESSAGE_LENGTH).join('');
}

export function validateDisplayName(value: string) {
  const normalizedValue = normalizeWhitespace(value);

  if (!normalizedValue) {
    return 'İsim alanını doldurmalısın.';
  }

  if (normalizedValue.length < MIN_NAME_LENGTH) {
    return `İsim en az ${MIN_NAME_LENGTH} karakter olmalı.`;
  }

  if (normalizedValue.length > MAX_NAME_LENGTH) {
    return `İsim en fazla ${MAX_NAME_LENGTH} karakter olabilir.`;
  }

  return null;
}

export function validateAge(value: number) {
  if (!Number.isFinite(value) || value < MIN_AGE || value > MAX_AGE) {
    return `Yaş ${MIN_AGE}-${MAX_AGE} arasında olmalı.`;
  }

  return null;
}

export function validateGender(value: UserGender | string) {
  if (!isUserGender(value)) {
    return 'Geçerli bir cinsiyet seçmelisin.';
  }

  return null;
}

export function validateBio(value: string) {
  const normalizedValue = normalizeBio(value);

  if (normalizedValue.length > MAX_BIO_LENGTH) {
    return `Biyografi en fazla ${MAX_BIO_LENGTH} karakter olabilir.`;
  }

  return null;
}

export function validateLetterboxd(value: string) {
  const normalizedValue = normalizeWhitespace(value);

  if (normalizedValue.length > MAX_LETTERBOXD_LENGTH) {
    return `Letterboxd alani en fazla ${MAX_LETTERBOXD_LENGTH} karakter olabilir.`;
  }

  return null;
}

export function validateMessageText(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return 'Mesaj boş olamaz.';
  }

  if (countMessageCharacters(normalizedValue) > MAX_MESSAGE_LENGTH) {
    return `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`;
  }

  return null;
}

export function validatePassword(value: string) {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı.`;
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Şifre en fazla ${MAX_PASSWORD_LENGTH} karakter olabilir.`;
  }

  return null;
}

export function clampSearchQuery(value: string) {
  return value.slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function validateCoordinate(
  value: number | null | undefined,
  type: 'latitude' | 'longitude',
) {
  if (value == null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return `${type === 'latitude' ? 'Enlem' : 'Boylam'} geçersiz.`;
  }

  if (type === 'latitude' && (value < -90 || value > 90)) {
    return 'Enlem -90 ile 90 arasında olmalı.';
  }

  if (type === 'longitude' && (value < -180 || value > 180)) {
    return 'Boylam -180 ile 180 arasında olmalı.';
  }

  return null;
}
