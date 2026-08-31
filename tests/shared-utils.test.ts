import { describe, expect, it } from 'vitest';

import { COMPATIBILITY_ALGORITHM_VERSION } from '../src/shared/constants/index.ts';

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
import { calculateKeyboardInset } from '../src/shared/utils/keyboard.ts';
import { getFixedGridItemWidth } from '../src/shared/utils/grid.ts';
import {
  isApiMessage,
  isApiUser,
  isCompatibilityDiscoveryEntry,
} from '../src/shared/utils/apiValidation.ts';
import {
  resolveBottomObstruction,
  resolveDeviceEdgeInset,
} from '../src/shared/utils/safeArea.ts';
import {
  createOptimisticMessage,
  mergeServerMessages,
  replaceOrAppendMessage,
  sortMessages,
} from '../src/app/components/chat/chatMessageModel.ts';
import {
  patchScreenSessionState,
  readScreenSessionState,
} from '../src/services/screenSessionState.ts';
import {
  decodeChatDirectoryCursor,
  decodeCompatibilityCursor,
  decodeLiveNowCursor,
  decodeMessageCursor,
  encodeChatDirectoryCursor,
  encodeCompatibilityCursor,
  encodeLiveNowCursor,
  encodeMessageCursor,
} from '../supabase/functions/make-server-d962235e/cursors.ts';

describe('bounded screen session state', () => {
  it('keeps each user and screen isolated while merging partial updates', () => {
    patchScreenSessionState('session-user-a', 'chat', { filter: 'unread' });
    patchScreenSessionState('session-user-a', 'chat', { scrollOffset: 240 });

    expect(readScreenSessionState('session-user-a', 'chat')).toEqual({
      filter: 'unread',
      scrollOffset: 240,
    });
    expect(readScreenSessionState('session-user-b', 'chat')).toEqual({
      filter: 'all',
      scrollOffset: 0,
    });
  });
});

describe('opaque keyset cursors', () => {
  it('round-trips every supported cursor without exposing invalid input', () => {
    const message = { created_at: '2026-07-31T12:00:00.000Z', id: 'message-1' };
    const live = { updated_at: '2026-07-31T12:01:00.000Z', user_id: 'user-1' };
    const directory = {
      activity_at: '2026-07-31T12:02:00.000Z',
      other_user_id: '00000000-0000-4000-8000-000000000001',
    };
    const compatibility = {
      compatibility_score: 72,
      user_id: '00000000-0000-4000-8000-000000000002',
    };

    expect(decodeMessageCursor(encodeMessageCursor(message))).toEqual({
      createdAt: message.created_at,
      id: message.id,
    });
    expect(decodeLiveNowCursor(encodeLiveNowCursor(live))).toEqual({
      updatedAt: live.updated_at,
      userId: live.user_id,
    });
    expect(decodeChatDirectoryCursor(encodeChatDirectoryCursor(directory))).toEqual({
      activityAt: directory.activity_at,
      userId: directory.other_user_id,
    });
    expect(decodeCompatibilityCursor(encodeCompatibilityCursor(compatibility))).toEqual({
      score: compatibility.compatibility_score,
      userId: compatibility.user_id,
    });
    expect(decodeMessageCursor('not-base64-json')).toBeNull();
    expect(decodeCompatibilityCursor(btoa(JSON.stringify({ score: 0, userId: 'bad' })))).toBeNull();
  });
});

describe('critical API runtime contracts', () => {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Ada',
    age: 28,
    showAgeOnProfile: true,
    gender: 'female',
    showGenderOnProfile: true,
    username: 'ada_test',
    bio: '',
    letterboxd: '',
    photos: ['https://example.test/photo.jpg'],
    favoriteMovies: [1],
    favoriteMedia: [{ id: 1, mediaType: 'movie' }],
    watchedMovies: [2],
    watchedMedia: [{ id: 2, mediaType: 'tv' }],
    currentlyWatching: null,
    currentlyWatchingMediaType: null,
    currentlyWatchingState: null,
    currentlyWatchingRemainingMs: null,
    currentlyWatchingExpiresAt: null,
    currentlyWatchingVersion: null,
    currentlyWatchingUpdatedAt: null,
    locationUpdatedAt: null,
    discoveryPreferences: {
      genderPreference: 'random',
      ageMin: 18,
      ageMax: 99,
      distanceMinKm: 0,
      distanceMaxKm: 500,
      compatibilityMin: 0,
      compatibilityMax: 100,
    },
  };

  it('accepts complete user and discovery payloads', () => {
    expect(isApiUser(user)).toBe(true);
    expect(isCompatibilityDiscoveryEntry({ user, score: 72 })).toBe(true);
  });

  it('rejects malformed nested user and score fields', () => {
    expect(isApiUser({ ...user, photos: [42] })).toBe(false);
    expect(isCompatibilityDiscoveryEntry({ user, score: 101 })).toBe(false);
  });

  it('validates message identity, participants and read state', () => {
    expect(isApiMessage({
      id: 'message-1',
      sender_id: user.id,
      receiver_id: '00000000-0000-4000-8000-000000000002',
      text: 'Merhaba',
      read: false,
      created_at: '2026-08-19T12:00:00.000Z',
    })).toBe(true);
    expect(isApiMessage({ id: 'message-1', read: 'false' })).toBe(false);
  });
});

describe('keyboard layout utilities', () => {
  it('adds only the keyboard area that Android did not already resize', () => {
    expect(calculateKeyboardInset(900, 600, 300)).toBe(0);
    expect(calculateKeyboardInset(900, 620, 300)).toBe(20);
    expect(calculateKeyboardInset(900, 900, 300)).toBe(300);
  });

  it('keeps a visible composer gap above Android keyboard toolbars', () => {
    expect(calculateKeyboardInset(900, 600, 300, 32)).toBe(32);
    expect(calculateKeyboardInset(900, 620, 300, 32)).toBe(52);
    expect(calculateKeyboardInset(900, 900, 300, 32)).toBe(332);
  });

  it('never returns a negative inset', () => {
    expect(calculateKeyboardInset(900, 500, 300)).toBe(0);
    expect(calculateKeyboardInset(900, 900, 0)).toBe(0);
    expect(calculateKeyboardInset(900, 900, 0, 32)).toBe(0);
  });
});

describe('fixed grid layout utilities', () => {
  it.each([296, 320, 336, 384, 408, 432])(
    'fits exactly three cards inside a %ipx content width without wrapping',
    (contentWidth) => {
      const gap = 8;
      const itemWidth = getFixedGridItemWidth(contentWidth, 3, gap);
      const occupiedWidth = itemWidth * 3 + gap * 2;

      expect(occupiedWidth).toBeLessThanOrEqual(contentWidth);
      expect(contentWidth - occupiedWidth).toBeLessThan(3);
    },
  );
});

describe('safe area layout utilities', () => {
  it('preserves real cutout and system bar insets while enforcing a small fallback', () => {
    expect(resolveDeviceEdgeInset(44)).toBe(44);
    expect(resolveDeviceEdgeInset(0)).toBe(12);
    expect(resolveDeviceEdgeInset(Number.NaN)).toBe(12);
  });

  it('keeps content above both the bottom navigation and keyboard', () => {
    expect(resolveBottomObstruction({ safeBottom: 34, bottomNavHeight: 52, extraGap: 12 })).toBe(98);
    expect(resolveBottomObstruction({ safeBottom: 34, keyboardHeight: 320, extraGap: 12 })).toBe(332);
  });
});

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
    expect(breakdown.algorithmVersion).toBe(COMPATIBILITY_ALGORITHM_VERSION);
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

  it('preserves symmetry, permutation, duplicate, type, and bounds invariants across generated libraries', () => {
    let state = 0x5eed1234;
    const nextInt = (max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % max;
    };
    const buildLibrary = () => Array.from({ length: nextInt(24) }, () => ({
      id: nextInt(40) + 1,
      mediaType: nextInt(2) === 0 ? 'movie' as const : 'tv' as const,
    }));
    const canonicalRefs = (refs: Array<{ id: number; mediaType: 'movie' | 'tv' }>) => (
      refs.map((ref) => `${ref.mediaType}:${ref.id}`).sort()
    );

    for (let example = 0; example < 300; example += 1) {
      const favoritesA = buildLibrary();
      const watchedA = buildLibrary();
      const favoritesB = buildLibrary();
      const watchedB = buildLibrary();
      const forward = getCompatibilityBreakdown(favoritesA, watchedA, favoritesB, watchedB);
      const reverse = getCompatibilityBreakdown(favoritesB, watchedB, favoritesA, watchedA);
      const permuted = getCompatibilityBreakdown(
        [...favoritesA].reverse(),
        [...watchedA].reverse(),
        [...favoritesB].reverse(),
        [...watchedB].reverse(),
      );
      const duplicated = getCompatibilityBreakdown(
        [...favoritesA, ...favoritesA],
        [...watchedA, ...watchedA],
        [...favoritesB, ...favoritesB],
        [...watchedB, ...watchedB],
      );

      expect(forward.algorithmVersion).toBe(1);
      expect(Number.isInteger(forward.score)).toBe(true);
      expect(forward.score).toBeGreaterThanOrEqual(0);
      expect(forward.score).toBeLessThanOrEqual(100);
      expect(reverse.score).toBe(forward.score);
      expect(permuted.score).toBe(forward.score);
      expect(duplicated.score).toBe(forward.score);
      expect(canonicalRefs(reverse.commonFavoriteRefs)).toEqual(canonicalRefs(forward.commonFavoriteRefs));
      expect(canonicalRefs(reverse.commonWatchedRefs)).toEqual(canonicalRefs(forward.commonWatchedRefs));
    }
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

describe('chat message model', () => {
  it('keeps the newest message first with a deterministic id tie-breaker', () => {
    const createdAt = '2026-07-20T12:00:00.000Z';
    const messages = [
      createOptimisticMessage({ id: 'a', senderId: 'me', receiverId: 'you', text: 'A', createdAt }),
      createOptimisticMessage({ id: 'b', senderId: 'me', receiverId: 'you', text: 'B', createdAt }),
    ];

    expect(sortMessages(messages).map((message) => message.id)).toEqual(['b', 'a']);
  });

  it('reconciles optimistic messages without duplicating the confirmed server message', () => {
    const createdAt = '2026-07-20T12:00:00.000Z';
    const optimistic = createOptimisticMessage({
      id: 'local-1',
      senderId: 'me',
      receiverId: 'you',
      text: 'Merhaba',
      createdAt,
    });
    const confirmed = {
      id: 'server-1',
      sender_id: 'me',
      receiver_id: 'you',
      text: 'Merhaba',
      read: false,
      created_at: createdAt,
    };

    const reconciled = replaceOrAppendMessage([optimistic], confirmed, optimistic.id);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ id: 'server-1', clientStatus: undefined });
    expect(mergeServerMessages([confirmed], [optimistic])).toHaveLength(1);
  });
});
