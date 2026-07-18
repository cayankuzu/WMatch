import {
  getChats,
  getChatThread,
  type ApiChat,
  type ApiChatThread,
  type ChatListResponse,
} from './api';
import { CHAT_THREAD_INITIAL_PAGE_SIZE } from '../shared/constants';
import { BoundedMap } from '../shared/utils/boundedMap';
import { registerSessionCache } from '../shared/utils/sessionCache';
import { prefetchProfilePhotos } from './profileImagePrefetch';

export const CHAT_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
export const CHAT_THREAD_CACHE_TTL_MS = 15 * 60 * 1000;

export interface ChatListCacheEntry {
  chats: ApiChat[];
  pageInfo: ChatListResponse['pageInfo'];
  expiresAt: number;
}

interface ChatThreadCacheEntry {
  thread: ApiChatThread;
  expiresAt: number;
}

const chatListCache = new BoundedMap<string, ChatListCacheEntry>(4);
const chatThreadCache = new BoundedMap<string, ChatThreadCacheEntry>(12);
const chatListFlights = new BoundedMap<string, Promise<ChatListResponse>>(4);
const chatThreadFlights = new BoundedMap<string, Promise<ApiChatThread | null>>(12);
let chatCacheGeneration = 0;

registerSessionCache(() => {
  chatCacheGeneration += 1;
  chatListCache.clear();
  chatThreadCache.clear();
  chatListFlights.clear();
  chatThreadFlights.clear();
});

function getChatThreadCacheKey(currentUserId: string, otherUserId: string) {
  return `${currentUserId}:${otherUserId}`;
}

export function readChatListCache(userId: string) {
  return chatListCache.get(userId);
}

export function hasChatListCache(userId: string) {
  return chatListCache.has(userId);
}

export function writeChatListCache(
  userId: string,
  chats: ApiChat[],
  pageInfo: ChatListResponse['pageInfo'],
) {
  chatListCache.set(userId, {
    chats,
    pageInfo,
    expiresAt: Date.now() + CHAT_LIST_CACHE_TTL_MS,
  });
}

export async function preloadChatList(userId: string, force = false) {
  const cached = readChatListCache(userId);

  if (!force && cached && cached.expiresAt > Date.now()) {
    return {
      chats: cached.chats,
      pageInfo: cached.pageInfo,
    } satisfies ChatListResponse;
  }

  const existingFlight = chatListFlights.get(userId);
  if (existingFlight) {
    return existingFlight;
  }

  const requestGeneration = chatCacheGeneration;
  const flight = getChats()
    .then((response) => {
      const chats = [...response.chats].sort(
        (left, right) => new Date(right.lastMessageTime).getTime() - new Date(left.lastMessageTime).getTime(),
      );
      const normalizedResponse = { ...response, chats };
      if (requestGeneration === chatCacheGeneration) {
        writeChatListCache(userId, chats, response.pageInfo);
        void prefetchProfilePhotos(chats.map((chat) => chat.user.photos), 6);
      }
      return normalizedResponse;
    })
    .finally(() => {
      if (chatListFlights.get(userId) === flight) {
        chatListFlights.delete(userId);
      }
    });

  chatListFlights.set(userId, flight);
  return flight;
}

export function readChatThreadCache(currentUserId: string, otherUserId: string) {
  const cacheKey = getChatThreadCacheKey(currentUserId, otherUserId);
  const cached = chatThreadCache.get(cacheKey);

  if (!cached || cached.expiresAt <= Date.now()) {
    chatThreadCache.delete(cacheKey);
    return null;
  }

  return cached.thread;
}

export function hasChatThreadCache(currentUserId: string, otherUserId: string) {
  return chatThreadCache.has(getChatThreadCacheKey(currentUserId, otherUserId));
}

export function deleteChatThreadCache(currentUserId: string, otherUserId: string) {
  chatThreadCache.delete(getChatThreadCacheKey(currentUserId, otherUserId));
}

export function writeChatThreadCache(
  currentUserId: string,
  otherUserId: string,
  thread: ApiChatThread,
) {
  const recentMessages = [...thread.messages]
    .sort((left, right) => {
      return (
        new Date(left.created_at).getTime() - new Date(right.created_at).getTime() ||
        left.id.localeCompare(right.id)
      );
    })
    .slice(-CHAT_THREAD_INITIAL_PAGE_SIZE);

  chatThreadCache.set(getChatThreadCacheKey(currentUserId, otherUserId), {
    thread: {
      ...thread,
      messages: recentMessages,
    },
    expiresAt: Date.now() + CHAT_THREAD_CACHE_TTL_MS,
  });
}

export async function preloadChatThread(
  currentUserId: string,
  otherUserId: string,
  force = false,
) {
  const cached = readChatThreadCache(currentUserId, otherUserId);
  if (!force && cached) {
    return cached;
  }

  const cacheKey = getChatThreadCacheKey(currentUserId, otherUserId);
  const existingFlight = chatThreadFlights.get(cacheKey);
  if (existingFlight) {
    return existingFlight;
  }

  const requestGeneration = chatCacheGeneration;
  const flight = getChatThread(otherUserId, { limit: CHAT_THREAD_INITIAL_PAGE_SIZE })
    .then((thread) => {
      if (thread && requestGeneration === chatCacheGeneration) {
        writeChatThreadCache(currentUserId, otherUserId, thread);
        void prefetchProfilePhotos([thread.chat.user.photos], 1);
      }

      return thread;
    })
    .finally(() => {
      if (chatThreadFlights.get(cacheKey) === flight) {
        chatThreadFlights.delete(cacheKey);
      }
    });

  chatThreadFlights.set(cacheKey, flight);
  return flight;
}
