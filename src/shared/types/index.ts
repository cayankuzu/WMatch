import type {
  DiscoveryPreferences,
  UserGender,
} from '../utils/discovery';

export type AuthScreen = 'login' | 'signup' | 'forgot';
export type AppTab = 'watch' | 'match' | 'compatibility' | 'likes' | 'chat' | 'profile';
export type FilterType = 'all' | 'unread' | 'read' | 'ended' | 'blocked';
export type MatchStatus = 'active' | 'ended' | 'blocked_by_user1' | 'blocked_by_user2';
export type MatchSourceType = 'watch' | 'compatibility' | 'like';
export type ChatSettingKey = 'readReceipts' | 'onlineStatus' | 'typingIndicator' | 'notifications';
export type SwipeQuotaKind = 'like' | 'dislike' | 'undo';
export type MediaType = 'movie' | 'tv';

export interface MediaRef {
  id: number;
  mediaType: MediaType;
}

export interface SignUpData {
  email: string;
  password: string;
  name: string;
  age: number;
  gender: UserGender;
  username: string;
  bio: string;
  letterboxd: string;
  photos: string[];
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  age: number;
  showAgeOnProfile: boolean;
  gender: UserGender;
  showGenderOnProfile: boolean;
  username: string;
  bio: string;
  letterboxd: string;
  photos: string[];
  favoriteMovies: number[];
  favoriteMedia: MediaRef[];
  watchedMovies: number[];
  watchedMedia: MediaRef[];
  currentlyWatching: number | null;
  currentlyWatchingMediaType: MediaType | null;
  currentlyWatchingState: 'active' | 'paused' | null;
  currentlyWatchingRemainingMs: number | null;
  currentlyWatchingExpiresAt: string | null;
  currentlyWatchingVersion: number | null;
  currentlyWatchingUpdatedAt: string | null;
  locationUpdatedAt: string | null;
  discoveryPreferences: DiscoveryPreferences;
  emailVerified: boolean;
}

export type ApiUser = Omit<AppUser, 'email' | 'emailVerified'>;

export interface ViewerPreview {
  id: string;
  name: string;
  photo: string | null;
}

export interface ApiMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  text: string;
  read: boolean;
  created_at: string;
  client_request_id?: string | null;
  client_message_id?: string | null;
}

export interface ApiMatch {
  user1_id: string;
  user2_id: string;
  status: MatchStatus;
  created_at: string;
}

export interface MatchContextSnapshot {
  type: MatchSourceType;
  compatibilityScore: number | null;
  matchedMovieId: number | null;
  commonFavoriteMovieIds: number[];
  commonWatchedMovieIds: number[];
  firstLikeByUserId: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
}

export interface ChatSettings {
  readReceipts: boolean;
  onlineStatus: boolean;
  typingIndicator: boolean;
  notifications: boolean;
}

export interface ApiChat {
  userId: string;
  user: ApiUser;
  lastMessage: string;
  lastMessageTime: string;
  hasConversationActivity: boolean;
  unread: boolean;
  status: MatchStatus;
  canSend: boolean;
  ended: boolean;
  blockedByMe: boolean;
  blockedByOther: boolean;
  isBlocked: boolean;
  lockedReason: string | null;
  matchContext: MatchContextSnapshot | null;
  settings: ChatSettings;
  peerSettings: ChatSettings;
}

export interface ApiChatThread {
  chat: ApiChat;
  messages: ApiMessage[];
  pageInfo?: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface CompatibilityDiscoveryEntry {
  user: ApiUser;
  score: number;
}

export interface SwipeQuotaState {
  windowStartedAt: string;
  likeLimit: number;
  dislikeLimit: number;
  undoLimit: number;
  usedLikes: number;
  usedDislikes: number;
  usedUndos: number;
  remainingLikes: number;
  remainingDislikes: number;
  remainingUndos: number;
  resetsAt: string;
  remainingMs: number;
}

export interface ProfileUpdateInput {
  name?: string;
  age?: number;
  showAgeOnProfile?: boolean;
  gender?: UserGender;
  showGenderOnProfile?: boolean;
  username?: string;
  bio?: string;
  letterboxd?: string;
  photos?: string[];
  latitude?: number | null;
  longitude?: number | null;
  locationUpdatedAt?: string | null;
  discoveryPreferences?: DiscoveryPreferences;
  favoriteMovies?: number[];
  favoriteMedia?: MediaRef[];
  watchedMovies?: number[];
  watchedMedia?: MediaRef[];
  currentlyWatching?: number | null;
  currentlyWatchingMediaType?: MediaType | null;
  currentlyWatchingAction?: 'start' | 'pause' | 'resume' | 'stop';
  currentlyWatchingVersion?: number | null;
}
