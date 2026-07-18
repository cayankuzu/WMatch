import { MAX_USERNAME_LENGTH } from '../constants/index.ts';

const USERNAME_ALLOWED_CHARACTERS_PATTERN = /^[A-Za-z0-9._]+$/;
const USERNAME_EDGE_CHARACTER_PATTERN = /^[A-Za-z0-9].*[A-Za-z0-9]$/;

export const MIN_USERNAME_LENGTH = 3;

export const USERNAME_RULES_HINT =
  `En az ${MIN_USERNAME_LENGTH}, en fazla ${MAX_USERNAME_LENGTH} karakter. Sadece harf, rakam, nokta ve alt çizgi kullanabilirsin.`;

export function stripUsernamePrefix(value: string) {
  return value.trim().replace(/^@+/, '');
}

export function normalizeUsername(value: string) {
  const usernameBody = stripUsernamePrefix(value);
  return usernameBody ? `@${usernameBody}` : '';
}

export function getUsernameValidationMessage(value: string) {
  const usernameBody = stripUsernamePrefix(value);

  if (!usernameBody) {
    return 'Kullanıcı adını girmelisin.';
  }

  if (usernameBody.length < MIN_USERNAME_LENGTH) {
    return `Kullanıcı adı en az ${MIN_USERNAME_LENGTH} karakter olmalı.`;
  }

  if (usernameBody.length > MAX_USERNAME_LENGTH) {
    return `Kullanıcı adı en fazla ${MAX_USERNAME_LENGTH} karakter olabilir.`;
  }

  if (!USERNAME_ALLOWED_CHARACTERS_PATTERN.test(usernameBody)) {
    return 'Kullanıcı adında sadece harf, rakam, nokta ve alt çizgi kullanabilirsin.';
  }

  if (!USERNAME_EDGE_CHARACTER_PATTERN.test(usernameBody)) {
    return 'Kullanıcı adı harf veya rakamla başlamalı ve bitmeli.';
  }

  return null;
}
