import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { useLocalization } from '../../../context/LocalizationContext';
import type { ApiChat } from '../../../services/api';
import { theme } from '../../../shared/theme';
import { formatRelativeTime } from '../../../shared/utils/time';
import useChatPresence from '../../hooks/useChatPresence';
import { getChatPreview } from './chatListModel';
import ChatAvatar from './ChatAvatar';

type Translate = ReturnType<typeof useLocalization>['t'];

interface ChatListItemProps {
  chat: ApiChat;
  currentUserId: string;
  presenceEnabled: boolean;
  onIntent: (chat: ApiChat) => void;
  onPress: (chat: ApiChat) => void;
  t: Translate;
}

function getChatTags(chat: ApiChat, t: Translate) {
  const tags: Array<{
    key: string;
    label: string;
    style: object;
    textStyle: object;
  }> = [];

  if (chat.isBlocked) {
    tags.push({
      key: 'blocked',
      label: chat.blockedByMe
        ? t('chat.screen.tag.blockedByMe')
        : t('chat.screen.tag.blockedByOther'),
      style: styles.tagDanger,
      textStyle: styles.tagDangerText,
    });
  }

  if (chat.ended) {
    tags.push({
      key: 'ended',
      label: t('chat.screen.tag.ended'),
      style: styles.tagMuted,
      textStyle: styles.tagMutedText,
    });
  }

  return tags;
}

function ChatListItem({
  chat,
  currentUserId,
  presenceEnabled,
  onIntent,
  onPress,
  t,
}: ChatListItemProps) {
  const photo = chat.user.photos.find((item) => item.trim().length > 0) ?? null;
  const tags = getChatTags(chat, t);
  const peerPresence = useChatPresence({
    currentUserId,
    otherUserId: chat.userId,
    peerSettings: chat.peerSettings,
    isTyping: false,
    publishTyping: false,
    enabled: presenceEnabled,
  });
  const isPeerTyping = !chat.ended && !chat.isBlocked && peerPresence.isTyping;
  const preview = isPeerTyping ? t('chat.screen.preview.typing') : getChatPreview(chat, t);
  const accessibilityLabel = [
    chat.user.name,
    preview,
    chat.unread ? t('chat.screen.tag.unread') : null,
  ].filter(Boolean).join('. ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => onIntent(chat)}
      onPress={() => onPress(chat)}
      style={({ pressed }) => [
        styles.row,
        chat.unread && styles.rowUnread,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.avatarWrap}>
        <ChatAvatar uri={photo} size={34} />
        {chat.unread ? <View style={styles.unreadDot} /> : null}
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.primaryColumn}>
            <Text numberOfLines={2} style={styles.name}>
              {chat.user.name}
            </Text>
            <Text
              numberOfLines={2}
              style={[
                styles.lastMessage,
                chat.unread && styles.lastMessageUnread,
                isPeerTyping && styles.lastMessageTyping,
              ]}
            >
              {preview}
            </Text>
          </View>

          <View style={styles.metaColumn}>
            <Text style={styles.time}>{formatRelativeTime(chat.lastMessageTime)}</Text>
            {tags.length > 0 ? (
              <View style={styles.tagRow}>
                {tags.map((tag) => (
                  <View key={tag.key} style={[styles.tag, tag.style]}>
                    <Text style={[styles.tagText, tag.textStyle]}>{tag.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default memo(ChatListItem);

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  rowPressed: {
    opacity: 0.86,
  },
  rowUnread: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    backgroundColor: theme.colors.backgroundElevated,
  },
  avatarWrap: {
    position: 'relative',
  },
  unreadDot: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.surface,
    backgroundColor: theme.colors.primarySoft,
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
  },
  primaryColumn: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  metaColumn: {
    alignItems: 'flex-end',
    gap: 5,
    minWidth: 58,
  },
  name: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  time: {
    color: theme.colors.textSoft,
    ...theme.typography.roles.micro,
    fontVariant: ['tabular-nums'],
  },
  lastMessage: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  lastMessageUnread: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bold,
  },
  lastMessageTyping: {
    color: theme.colors.successText,
    fontFamily: theme.fonts.bold,
  },
  tagRow: {
    alignItems: 'flex-end',
    gap: 5,
  },
  tag: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tagText: {
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  tagMuted: {
    backgroundColor: theme.colors.surfaceStrong,
  },
  tagMutedText: {
    color: theme.colors.textMuted,
  },
  tagDanger: {
    backgroundColor: theme.colors.dangerSurface,
  },
  tagDangerText: {
    color: theme.colors.dangerText,
  },
});
