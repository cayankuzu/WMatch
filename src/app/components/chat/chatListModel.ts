import type { ApiChat, ApiMessage } from '../../../services/api';
import { sortChats } from '../../../services/chatState';
import type { Translate } from '../../../shared/i18n/messages';
import type { FilterType } from '../../../shared/types';

export function getChatPreview(chat: ApiChat, t: Translate) {
  if (chat.lastMessage.trim()) {
    return chat.lastMessage;
  }

  if (chat.blockedByMe) {
    return t('chat.screen.preview.blockedByMe');
  }

  if (chat.blockedByOther) {
    return t('chat.screen.preview.blockedByOther');
  }

  if (chat.ended) {
    return t('chat.screen.preview.ended');
  }

  return t('chat.screen.preview.matched');
}

export function hasVisibleConversationActivity(chat: ApiChat) {
  return chat.hasConversationActivity || chat.lastMessage.trim().length > 0;
}

export function matchesChatFilter(chat: ApiChat, filter: FilterType) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'blocked') {
    return chat.isBlocked;
  }

  if (filter === 'ended') {
    return chat.ended && !chat.isBlocked;
  }

  if (chat.isBlocked || chat.ended) {
    return false;
  }

  if (filter === 'unread') {
    return chat.unread;
  }

  if (filter === 'read') {
    return hasVisibleConversationActivity(chat) && !chat.unread;
  }

  return true;
}

export function applyMessageInsertToChats({
  chats,
  currentUserId,
  message,
  activeThreadUserId,
}: {
  chats: ApiChat[];
  currentUserId: string;
  message: ApiMessage;
  activeThreadUserId: string | null;
}) {
  const otherUserId = message.sender_id === currentUserId ? message.receiver_id : message.sender_id;
  let didUpdate = false;

  const nextChats = chats.map((chat) => {
    if (chat.userId !== otherUserId) {
      return chat;
    }

    didUpdate = true;
    return {
      ...chat,
      lastMessage: message.text,
      lastMessageTime: message.created_at,
      hasConversationActivity: true,
      unread: message.sender_id === currentUserId ? chat.unread : activeThreadUserId !== otherUserId,
    };
  });

  return {
    chats: didUpdate ? sortChats(nextChats) : chats,
    didUpdate,
  };
}
