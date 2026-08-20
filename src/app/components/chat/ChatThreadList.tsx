import { forwardRef, memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { ApiRequestError } from '../../../services/api';
import { CHAT_THREAD_INITIAL_PAGE_SIZE } from '../../../shared/constants';
import { theme } from '../../../shared/theme';
import DataState from '../ui/DataState';
import { MessageThreadSkeleton } from '../ui/Skeleton';
import ChatMessageBubble, { type LocalChatMessage } from './ChatMessageBubble';

const MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 } as const;

interface ChatThreadListProps {
  canSend: boolean;
  currentUserId: string;
  failedLabel: string;
  loading: boolean;
  loadingOlder: boolean;
  messages: LocalChatMessage[];
  peerReadReceipts: boolean;
  threadError: ApiRequestError | Error | null;
  onDismissComposer: () => void;
  onFailedMessagePress: (message: LocalChatMessage) => void;
  onLoadOlder: () => void;
  onRetry: () => void;
  onScrollOffset: (offset: number) => void;
  onUserScroll: () => void;
}

const ChatThreadList = memo(forwardRef<FlatList<LocalChatMessage>, ChatThreadListProps>(function ChatThreadList({
  canSend,
  currentUserId,
  failedLabel,
  loading,
  loadingOlder,
  messages,
  peerReadReceipts,
  threadError,
  onDismissComposer,
  onFailedMessagePress,
  onLoadOlder,
  onRetry,
  onScrollOffset,
  onUserScroll,
}, ref) {
  const { t } = useLocalization();
  const loadingSkeleton = loading && messages.length === 0;
  const threadFailed = !loading && messages.length === 0 && threadError != null;
  const placeholder = !loading && messages.length === 0 && !threadFailed;

  return (
    <FlatList
      ref={ref}
      data={messages}
      inverted
      keyExtractor={(item) => item.id}
      contentContainerStyle={[
        styles.messages,
        (placeholder || threadFailed) && styles.messagesEmpty,
        loadingSkeleton && styles.messagesLoading,
      ]}
      keyboardShouldPersistTaps="never"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      initialNumToRender={CHAT_THREAD_INITIAL_PAGE_SIZE}
      maxToRenderPerBatch={12}
      windowSize={7}
      maintainVisibleContentPosition={MAINTAIN_VISIBLE_POSITION}
      onTouchStart={onDismissComposer}
      onScrollBeginDrag={() => {
        onUserScroll();
        onDismissComposer();
      }}
      onScroll={(event) => onScrollOffset(Math.max(0, event.nativeEvent.contentOffset.y))}
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.2}
      scrollEventThrottle={32}
      ListFooterComponent={loadingOlder ? (
        <View style={styles.loadingOlder}><ActivityIndicator color={theme.colors.primarySoft} /></View>
      ) : null}
      renderItem={({ item }) => {
        const isOwn = item.sender_id === currentUserId;
        return (
          <View style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
            <ChatMessageBubble
              message={item}
              isOwn={isOwn}
              canShowReadReceipt={peerReadReceipts}
              failedLabel={failedLabel}
              onFailedPress={isOwn ? () => onFailedMessagePress(item) : undefined}
            />
          </View>
        );
      }}
      ListEmptyComponent={loadingSkeleton ? (
        <MessageThreadSkeleton />
      ) : threadFailed ? (
        <DataState
          state="fatal-error"
          title={t('data.error.title')}
          description={threadError instanceof ApiRequestError ? t(threadError.userMessageKey as never) : t('data.error.generic')}
          actionLabel={t('data.action.retry')}
          onAction={onRetry}
        />
      ) : placeholder ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons name="heart" size={22} color={theme.colors.primarySoft} />
          </View>
          <Text style={styles.emptyTitle}>{t('chat.modal.empty.title')}</Text>
          <Text style={styles.emptyDescription}>
            {canSend ? t('chat.modal.empty.description.start') : t('chat.modal.empty.description.locked')}
          </Text>
        </View>
      ) : null}
    />
  );
}));

ChatThreadList.displayName = 'ChatThreadList';
export default ChatThreadList;

const styles = StyleSheet.create({
  loadingOlder: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  messages: { flexGrow: 1, padding: 10, gap: 4 },
  messagesEmpty: { alignItems: 'center', justifyContent: 'center' },
  messagesLoading: { flex: 1 },
  messageRow: { flexDirection: 'row' },
  messageRowOwn: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  emptyState: { alignItems: 'center', paddingHorizontal: 16, gap: 6 },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
    marginBottom: 6,
  },
  emptyTitle: { color: theme.colors.text, ...theme.typography.roles.cardTitle },
  emptyDescription: { color: theme.colors.textMuted, ...theme.typography.roles.body, textAlign: 'center' },
});
