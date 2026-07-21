import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ApiMessage } from '../../../shared/types';
import { theme } from '../../../shared/theme';
import { formatChatTimestamp } from '../../../shared/utils/time';

export interface LocalChatMessage extends ApiMessage {
  clientStatus?: 'sending' | 'failed';
}

interface ChatMessageBubbleProps {
  message: LocalChatMessage;
  isOwn: boolean;
  canShowReadReceipt: boolean;
  failedLabel: string;
  onFailedPress?: () => void;
}

function MessageStatusIcon({
  message,
  canShowReadReceipt,
}: Pick<ChatMessageBubbleProps, 'message' | 'canShowReadReceipt'>) {
  if (message.clientStatus === 'sending') {
    return <MaterialCommunityIcons accessible={false} name="clock-outline" size={12} color={theme.colors.textSecondary} />;
  }

  if (message.clientStatus === 'failed') {
    return <MaterialCommunityIcons accessible={false} name="alert-circle-outline" size={12} color={theme.colors.dangerText} />;
  }

  if (message.read && canShowReadReceipt) {
    return <MaterialCommunityIcons accessible={false} name="check-all" size={14} color={theme.colors.white} />;
  }

  return <MaterialCommunityIcons accessible={false} name="check" size={13} color={theme.colors.white} />;
}

export default function ChatMessageBubble({
  message,
  isOwn,
  canShowReadReceipt,
  failedLabel,
  onFailedPress,
}: ChatMessageBubbleProps) {
  const bubbleContent = (
    <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
      <Text style={[styles.messageText, !isOwn && styles.messageTextOther]}>{message.text}</Text>

      <View style={styles.metaRow}>
        {message.clientStatus === 'failed' ? <Text style={styles.failedText}>{failedLabel}</Text> : null}
        <Text style={[styles.messageTime, isOwn && styles.messageTimeOwn]}>
          {formatChatTimestamp(message.created_at)}
        </Text>
        {isOwn ? <MessageStatusIcon message={message} canShowReadReceipt={canShowReadReceipt} /> : null}
      </View>
    </View>
  );

  if (!isOwn || message.clientStatus !== 'failed' || !onFailedPress) {
    return bubbleContent;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={failedLabel}
      hitSlop={4}
      onPress={onFailedPress}
      style={styles.retryButton}
    >
      {bubbleContent}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '76%',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 2,
  },
  bubbleOwn: {
    borderBottomRightRadius: 6,
    backgroundColor: theme.colors.primary,
  },
  bubbleOther: {
    borderBottomLeftRadius: 6,
    backgroundColor: theme.colors.surface,
  },
  messageText: {
    color: theme.colors.white,
    ...theme.typography.roles.meta,
  },
  messageTextOther: {
    color: theme.colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    gap: 4,
  },
  messageTime: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.micro,
    fontVariant: ['tabular-nums'],
  },
  messageTimeOwn: {
    color: theme.colors.white,
  },
  failedText: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  retryButton: {
    minHeight: 36,
    justifyContent: 'center',
  },
});
