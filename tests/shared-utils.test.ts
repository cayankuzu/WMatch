import { describe, expect, it } from 'vitest';

import {
  normalizeWhitespace,
  validateCoordinate,
  validateMessageText,
  validatePassword,
} from '../src/shared/utils/validation.ts';
import {
  getUsernameValidationMessage,
  normalizeUsername,
} from '../src/shared/utils/username.ts';
import {
  calculateCompatibilityScore,
  getCompatibilityBreakdown,
} from '../src/shared/utils/compatibility.ts';
import { BoundedMap } from '../src/shared/utils/boundedMap.ts';

describe('validation utilities', () => {
  it('normalizes whitespace without preserving leading or repeated spaces', () => {
    expect(normalizeWhitespace('  Ada   Lovelace  ')).toBe('Ada Lovelace');
  });

  it('guards password and message boundaries', () => {
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('1234567')).not.toBeNull();
    expect(validatePassword('x'.repeat(73))).not.toBeNull();

    expect(validateMessageText(' hello ')).toBeNull();
    expect(validateMessageText('   ')).not.toBeNull();
    expect(validateMessageText('x'.repeat(701))).not.toBeNull();
  });

  it('rejects invalid coordinates while allowing unset location fields', () => {
    expect(validateCoordinate(null, 'latitude')).toBeNull();
    expect(validateCoordinate(41.01, 'latitude')).toBeNull();
    expect(validateCoordinate(91, 'latitude')).not.toBeNull();
    expect(validateCoordinate(-181, 'longitude')).not.toBeNull();
  });
});

describe('username utilities', () => {
  it('normalizes optional @ prefixes', () => {
    expect(normalizeUsername(' @@film.friend ')).toBe('@film.friend');
  });

  it('accepts only safe public username shapes', () => {
    expect(getUsernameValidationMessage('@film_friend')).toBeNull();
    expect(getUsernameValidationMessage('@ab')).not.toBeNull();
    expect(getUsernameValidationMessage('@film!friend')).not.toBeNull();
    expect(getUsernameValidationMessage('@.filmfriend')).not.toBeNull();
  });
});

describe('compatibility utilities', () => {
  it('deduplicates common movie ids and applies weighted scoring', () => {
    const breakdown = getCompatibilityBreakdown([1, 2, 2, 3], [10, 11], [2, 3, 4], [11, 12]);

    expect(breakdown.commonFavoriteIds).toEqual([2, 3]);
    expect(breakdown.commonWatchedIds).toEqual([11]);
    expect(breakdown.commonLibraryIds).toEqual([2, 3, 11]);
    expect(breakdown.score).toBe(44);
    expect(calculateCompatibilityScore([1, 2, 3], [10, 11], [2, 3, 4], [11, 12])).toBe(44);
  });

  it('keeps movie and tv identities separate when numeric ids collide', () => {
    const collision = getCompatibilityBreakdown(
      [{ id: 123, mediaType: 'movie' }],
      [],
      [{ id: 123, mediaType: 'tv' }],
      [],
    );

    expect(collision.commonFavoriteIds).toEqual([]);
    expect(collision.commonFavoriteRefs).toEqual([]);
    expect(collision.score).toBe(0);

    const typedMatch = getCompatibilityBreakdown(
      [{ id: 123, mediaType: 'tv' }],
      [],
      [{ id: 123, mediaType: 'tv' }],
      [],
    );

    expect(typedMatch.commonFavoriteRefs).toEqual([{ id: 123, mediaType: 'tv' }]);
    expect(typedMatch.score).toBe(100);
  });
});

describe('bounded cache', () => {
  it('evicts the least recently used entry and keeps recently read entries', () => {
    const cache = new BoundedMap<string, number>(2);
    cache.set('first', 1);
    cache.set('second', 2);
    expect(cache.get('first')).toBe(1);

    cache.set('third', 3);

    expect(cache.get('second')).toBeUndefined();
    expect(cache.get('first')).toBe(1);
    expect(cache.get('third')).toBe(3);
    expect(cache.size).toBe(2);
  });
});
