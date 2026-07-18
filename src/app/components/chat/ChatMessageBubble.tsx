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
  onRetry?: () => void;
}

function MessageStatusIcon({
  message,
  canShowReadReceipt,
}: Pick<ChatMessageBubbleProps, 'message' | 'canShowReadReceipt'>) {
  if (message.clientStatus === 'sending') {
    return <MaterialCommunityIcons accessible={false} name="clock-outline" size={14} color={theme.colors.textSecondary} />;
  }

  if (message.clientStatus === 'failed') {
    return <MaterialCommunityIcons accessible={false} name="alert-circle-outline" size={14} color={theme.colors.dangerText} />;
  }

  if (message.read && canShowReadReceipt) {
    return <MaterialCommunityIcons accessible={false} name="check" size={17} color={theme.colors.successText} />;
  }

  return <MaterialCommunityIcons accessible={false} name="check" size={15} color={theme.colors.white} />;
}

export default function ChatMessageBubble({
  message,
  isOwn,
  canShowReadReceipt,
  failedLabel,
  onRetry,
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

  if (!isOwn || message.clientStatus !== 'failed' || !onRetry) {
    return bubbleContent;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={failedLabel}
      onPress={onRetry}
      style={styles.retryButton}
    >
      {bubbleContent}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '78%',
    borderRadius: 17,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
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
    fontSize: theme.typography.body,
    lineHeight: 21,
  },
  messageTextOther: {
    color: theme.colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'flex-end',
    gap: 5,
  },
  messageTime: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  messageTimeOwn: {
    color: theme.colors.white,
  },
  failedText: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  retryButton: {
    minHeight: theme.layout.controlMinUnified,
    justifyContent: 'center',
  },
});
