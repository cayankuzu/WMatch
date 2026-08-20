import type {
  ApiChat,
  ApiChatThread,
  ApiMatch,
  ApiMessage,
  ApiUser,
  AppUser,
  ChatSettings,
  CompatibilityDiscoveryEntry,
  MatchContextSnapshot,
  MediaRef,
} from '../types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isNullableNumber = (value: unknown): value is number | null => value === null || isFiniteNumber(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isPositiveIntegerArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => Number.isInteger(item) && item > 0);

function isMediaRef(value: unknown): value is MediaRef {
  return isRecord(value)
    && Number.isInteger(value.id)
    && Number(value.id) > 0
    && (value.mediaType === 'movie' || value.mediaType === 'tv');
}

const isMediaRefArray = (value: unknown): value is MediaRef[] =>
  Array.isArray(value) && value.every(isMediaRef);

function isDiscoveryPreferences(value: unknown) {
  return isRecord(value)
    && ['random', 'female', 'male', 'nonbinary'].includes(String(value.genderPreference))
    && isFiniteNumber(value.ageMin)
    && isFiniteNumber(value.ageMax)
    && isFiniteNumber(value.distanceMinKm)
    && isFiniteNumber(value.distanceMaxKm)
    && isFiniteNumber(value.compatibilityMin)
    && isFiniteNumber(value.compatibilityMax);
}

export function isApiUser(value: unknown): value is ApiUser {
  if (!isRecord(value)) {
    return false;
  }

  return isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isFiniteNumber(value.age)
    && value.age >= 18
    && value.age <= 99
    && isBoolean(value.showAgeOnProfile)
    && ['female', 'male', 'nonbinary', 'other'].includes(String(value.gender))
    && isBoolean(value.showGenderOnProfile)
    && isString(value.username)
    && isString(value.bio)
    && isString(value.letterboxd)
    && isStringArray(value.photos)
    && isPositiveIntegerArray(value.favoriteMovies)
    && isMediaRefArray(value.favoriteMedia)
    && isPositiveIntegerArray(value.watchedMovies)
    && isMediaRefArray(value.watchedMedia)
    && (value.currentlyWatching === null || (Number.isInteger(value.currentlyWatching) && Number(value.currentlyWatching) > 0))
    && (value.currentlyWatchingMediaType === null || value.currentlyWatchingMediaType === 'movie' || value.currentlyWatchingMediaType === 'tv')
    && (value.currentlyWatchingState === null || value.currentlyWatchingState === 'active' || value.currentlyWatchingState === 'paused')
    && isNullableNumber(value.currentlyWatchingRemainingMs)
    && isNullableString(value.currentlyWatchingExpiresAt)
    && isNullableNumber(value.currentlyWatchingVersion)
    && isNullableString(value.currentlyWatchingUpdatedAt)
    && isNullableString(value.locationUpdatedAt)
    && isDiscoveryPreferences(value.discoveryPreferences);
}

export function isAppUser(value: unknown): value is AppUser {
  if (!isApiUser(value) || !isRecord(value)) {
    return false;
  }

  const authenticatedUser = value as unknown as Record<string, unknown>;
  return isString(authenticatedUser.email) && isBoolean(authenticatedUser.emailVerified);
}

export function isApiMessage(value: unknown): value is ApiMessage {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.sender_id)
    && isNonEmptyString(value.receiver_id)
    && isString(value.text)
    && isBoolean(value.read)
    && isNonEmptyString(value.created_at)
    && (value.client_request_id === undefined || isNullableString(value.client_request_id))
    && (value.client_message_id === undefined || isNullableString(value.client_message_id));
}

export function isApiMatch(value: unknown): value is ApiMatch {
  return isRecord(value)
    && isNonEmptyString(value.user1_id)
    && isNonEmptyString(value.user2_id)
    && ['active', 'ended', 'blocked_by_user1', 'blocked_by_user2'].includes(String(value.status))
    && isNonEmptyString(value.created_at);
}

function isChatSettings(value: unknown): value is ChatSettings {
  return isRecord(value)
    && isBoolean(value.readReceipts)
    && isBoolean(value.onlineStatus)
    && isBoolean(value.typingIndicator)
    && isBoolean(value.notifications);
}

function isMatchContext(value: unknown): value is MatchContextSnapshot {
  return isRecord(value)
    && ['watch', 'compatibility', 'like'].includes(String(value.type))
    && isNullableNumber(value.compatibilityScore)
    && isNullableNumber(value.matchedMovieId)
    && isPositiveIntegerArray(value.commonFavoriteMovieIds)
    && isPositiveIntegerArray(value.commonWatchedMovieIds)
    && isNullableString(value.firstLikeByUserId)
    && isNullableString(value.acceptedByUserId)
    && isNonEmptyString(value.createdAt);
}

export function isApiChat(value: unknown): value is ApiChat {
  return isRecord(value)
    && isNonEmptyString(value.userId)
    && isApiUser(value.user)
    && isString(value.lastMessage)
    && isNonEmptyString(value.lastMessageTime)
    && isBoolean(value.hasConversationActivity)
    && isBoolean(value.unread)
    && ['active', 'ended', 'blocked_by_user1', 'blocked_by_user2'].includes(String(value.status))
    && isBoolean(value.canSend)
    && isBoolean(value.ended)
    && isBoolean(value.blockedByMe)
    && isBoolean(value.blockedByOther)
    && isBoolean(value.isBlocked)
    && isNullableString(value.lockedReason)
    && (value.matchContext === null || isMatchContext(value.matchContext))
    && isChatSettings(value.settings)
    && isChatSettings(value.peerSettings);
}

export function isApiChatThread(value: unknown): value is ApiChatThread {
  return isRecord(value)
    && isApiChat(value.chat)
    && Array.isArray(value.messages)
    && value.messages.every(isApiMessage)
    && (
      value.pageInfo === undefined
      || (
        isRecord(value.pageInfo)
        && isBoolean(value.pageInfo.hasMore)
        && isNullableString(value.pageInfo.nextCursor)
      )
    );
}

export function isCompatibilityDiscoveryEntry(value: unknown): value is CompatibilityDiscoveryEntry {
  return isRecord(value)
    && isApiUser(value.user)
    && Number.isInteger(value.score)
    && Number(value.score) > 0
    && Number(value.score) <= 100;
}
