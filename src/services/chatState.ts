import type { ApiChat } from './api';
import type { ChatSettings } from '../shared/types';

export type ChatPatch = Partial<Omit<ApiChat, 'userId' | 'user'>>;

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  readReceipts: true,
  onlineStatus: true,
  typingIndicator: true,
  notifications: true,
};

export function normalizeChat(chat: ApiChat): ApiChat {
  return {
    ...chat,
    settings: chat.settings ?? DEFAULT_CHAT_SETTINGS,
    peerSettings: chat.peerSettings ?? DEFAULT_CHAT_SETTINGS,
  };
}

export function patchChat(chat: ApiChat, patch: ChatPatch): ApiChat {
  return {
    ...chat,
    ...patch,
    settings: patch.settings ?? chat.settings,
    peerSettings: patch.peerSettings ?? chat.peerSettings,
  };
}

export function sortChats(chats: ApiChat[]) {
  return [...chats].sort(
    (left, right) => new Date(right.lastMessageTime).getTime() - new Date(left.lastMessageTime).getTime(),
  );
}

export function upsertChat(chats: ApiChat[], nextChat: ApiChat) {
  return sortChats([...chats.filter((chat) => chat.userId !== nextChat.userId), nextChat]);
}

export function patchChatList(chats: ApiChat[], userId: string, patch: ChatPatch) {
  let changed = false;
  const nextChats = chats.map((chat) => {
    if (chat.userId !== userId) {
      return chat;
    }

    changed = true;
    return patchChat(chat, patch);
  });

  return changed ? sortChats(nextChats) : chats;
}
