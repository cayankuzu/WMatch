import type {
  ApiChat,
  ApiUser,
  CompatibilityDiscoveryEntry,
  MatchContextSnapshot,
  SwipeQuotaState,
} from '../../shared/types';

export interface SubmitUserReportPayload {
  targetUserId: string;
  reasonCode: string;
  details: string;
  matchContext?: MatchContextSnapshot | null;
  clientContext?: Record<string, unknown>;
}

export interface LikeUserResult {
  matched: boolean;
  success: boolean;
  errorMessage?: string;
  rewardLikes?: number;
  quota?: SwipeQuotaState;
  matchedUser?: ApiUser | null;
}

export interface LikesDiscoveryResponse {
  likedUsers: ApiUser[];
  likedByUsers: ApiUser[];
  likedByUserIds: string[];
  likedByCount: number;
  likedByLocked: boolean;
}

export interface LiveNowResponse {
  users: ApiUser[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface CompatibilityDiscoveryResponse {
  entries: CompatibilityDiscoveryEntry[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface WatchDiscoveryResponse {
  users: ApiUser[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface ChatListResponse {
  chats: ApiChat[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface HealthStatus {
  ok: boolean;
  apiVersion: string;
  release: string;
  requiredSchema: string;
  serverTime: string;
  requestId: string;
  schemaReady: boolean;
}
