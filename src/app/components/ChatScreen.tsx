import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type ViewToken,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import {
  ApiRequestError,
  blockUser,
  getChats,
  unblockUser,
  type ApiChat,
  type ApiMessage,
} from '../../services/api';
import {
  hasChatListCache,
  preloadChatList,
  preloadChatThread,
  readChatListCache,
  writeChatListCache,
} from '../../services/chatCache';
import {
  patchChat,
  patchChatList,
  sortChats,
  upsertChat,
  type ChatPatch,
} from '../../services/chatState';
import { subscribeToUserEvent } from '../../services/userEventBus';
import { setTabBadge } from '../../services/tabBadges';
import { SCREEN_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../shared/constants';
import type { Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import type { FilterType } from '../../shared/types';
import { formatRelativeTime } from '../../shared/utils/time';
import ChatModal from './ChatModal';
import EmptyState from './EmptyState';
import ProfileModal from './ProfileModal';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import { ChatListSkeleton } from './ui/Skeleton';
import AppRefreshControl from './ui/AppRefreshControl';
import useChatPresence from '../hooks/useChatPresence';
import useTabReselect from '../hooks/useTabReselect';
import ChatAvatar from './chat/ChatAvatar';
import ScreenHeader from './ui/ScreenHeader';
import {
  applyMessageInsertToChats,
  getChatPreview,
  hasVisibleConversationActivity,
  matchesChatFilter,
} from './chat/chatListModel';

interface ChatScreenProps {
  onMovieClick?: (movie: Movie) => void;
  requestedOpenUserId?: string | null;
  onRequestedOpenUserIdHandled?: (userId: string) => void;
}

function getChatTags(chat: ApiChat, t: ReturnType<typeof useLocalization>['t']) {
  const tags: Array<{ key: string; label: string; style: object; textStyle: object }> = [];

  if (chat.isBlocked) {
    tags.push({
      key: 'blocked',
      label: chat.blockedByMe ? t('chat.screen.tag.blockedByMe') : t('chat.screen.tag.blockedByOther'),
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
}: {
  chat: ApiChat;
  currentUserId: string;
  presenceEnabled: boolean;
  onIntent: () => void;
  onPress: () => void;
  t: ReturnType<typeof useLocalization>['t'];
}) {
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

  return (
    <Pressable
      key={chat.userId}
      accessibilityRole="button"
      accessibilityLabel={`${chat.user.name}. ${preview}. ${chat.unread ? t('chat.screen.tag.unread') : ''}`}
      accessibilityState={{ selected: chat.unread }}
      onPressIn={onIntent}
      onPress={onPress}
      style={({ pressed }) => [styles.chatRow, chat.unread && styles.chatRowUnread, pressed && styles.chatRowPressed]}
    >
      <View style={styles.avatarWrap}>
        <ChatAvatar uri={photo} size={34} />
        {chat.unread ? <View style={styles.unreadDot} /> : null}
      </View>

      <View style={styles.chatBody}>
        <View style={styles.chatTopRow}>
          <View style={styles.chatPrimaryColumn}>
            <Text numberOfLines={2} style={styles.chatName}>
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

          <View style={styles.chatMetaColumn}>
            <Text style={styles.chatTime}>{formatRelativeTime(chat.lastMessageTime)}</Text>

            {tags.length > 0 ? (
              <View style={styles.tagRow}>
                {tags.map((tag) => (
                  <View key={tag.key} style={[styles.tagBase, tag.style]}>
                    <Text style={[styles.tagBaseText, tag.textStyle]}>{tag.label}</Text>
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

export default function ChatScreen({
  onMovieClick,
  requestedOpenUserId,
  onRequestedOpenUserIdHandled,
}: ChatScreenProps) {
  const { user: currentUser } = useAuth();
  const { t } = useLocalization();
  const initialChatCacheEntry = currentUser ? readChatListCache(currentUser.id) : undefined;
  const initialCachedChats = initialChatCacheEntry?.chats ?? [];
  const [chats, setChats] = useState<ApiChat[]>(initialCachedChats);
  const [loading, setLoading] = useState(() => Boolean(currentUser && !initialChatCacheEntry));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [chatPageInfo, setChatPageInfo] = useState<{ hasMore: boolean; nextCursor: string | null }>(
    initialChatCacheEntry?.pageInfo ?? { hasMore: true, nextCursor: null },
  );
  const [loadError, setLoadError] = useState<ApiRequestError | Error | null>(null);
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [activeChat, setActiveChat] = useState<ApiChat | null>(null);
  const listRef = useRef<FlatList<ApiChat> | null>(null);
  const scrollToTop = useCallback(() => {
    if (!activeChat) {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  }, [activeChat]);

  useTabReselect('chat', scrollToTop);
  const [profileChat, setProfileChat] = useState<ApiChat | null>(null);
  const [profileBlockBusy, setProfileBlockBusy] = useState(false);
  const [visibleChatIds, setVisibleChatIds] = useState<Set<string>>(
    () => new Set(initialCachedChats.slice(0, 12).map((chat) => chat.userId)),
  );
  const chatsRef = useRef<ApiChat[]>([]);
  const chatPageInfoRef = useRef(chatPageInfo);
  const loadRequestSequenceRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const silentRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 10 });
  const onViewableItemsChangedRef = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken<ApiChat>> }) => {
      const nextVisibleChatIds = new Set(
        viewableItems
          .map(({ item }) => item?.userId)
          .filter((userId): userId is string => Boolean(userId)),
      );

      setVisibleChatIds((current) => {
        const unchanged =
          current.size === nextVisibleChatIds.size &&
          [...current].every((userId) => nextVisibleChatIds.has(userId));
        return unchanged ? current : nextVisibleChatIds;
      });
    },
  );

  const filters = useMemo<Array<{ label: string; value: FilterType }>>(
    () => [
      { label: t('chat.screen.filter.all'), value: 'all' },
      { label: t('chat.screen.filter.unread'), value: 'unread' },
      { label: t('chat.screen.filter.read'), value: 'read' },
      { label: t('chat.screen.filter.ended'), value: 'ended' },
      { label: t('chat.screen.filter.blocked'), value: 'blocked' },
    ],
    [t],
  );

  const loadChats = useCallback(async (mode: 'load' | 'refresh' | 'silent' | 'more' = 'load') => {
    if (!currentUser) {
      loadRequestSequenceRef.current += 1;
      setChats([]);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      setChatPageInfo({ hasMore: false, nextCursor: null });
      return;
    }

    if (
      mode === 'more' &&
      (loadingMoreRef.current || !chatPageInfoRef.current.hasMore || !chatPageInfoRef.current.nextCursor)
    ) {
      return;
    }

    const requestSequence = ++loadRequestSequenceRef.current;
    const requestUserId = currentUser.id;

    if (mode === 'refresh') {
      setRefreshing(true);
    } else if (mode === 'more') {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else if (mode === 'load' && chatsRef.current.length === 0) {
      setLoading(true);
    }

    try {
      const response = mode === 'more'
        ? await getChats({ cursor: chatPageInfoRef.current.nextCursor })
        : await preloadChatList(currentUser.id, mode === 'refresh' || mode === 'silent');

      if (requestSequence !== loadRequestSequenceRef.current || requestUserId !== currentUser.id) {
        return;
      }

      const sortedChats = sortChats(response.chats);

      if (mode === 'more' || mode === 'silent') {
        setChats((current) => {
          const merged = new Map(current.map((chat) => [chat.userId, chat]));
          sortedChats.forEach((chat) => merged.set(chat.userId, chat));
          return sortChats([...merged.values()]);
        });
      } else {
        writeChatListCache(currentUser.id, sortedChats, response.pageInfo);
        setChats(sortedChats);
      }

      if (
        mode !== 'silent' ||
        chatsRef.current.length <= sortedChats.length ||
        !chatPageInfoRef.current.nextCursor
      ) {
        chatPageInfoRef.current = response.pageInfo;
        setChatPageInfo(response.pageInfo);
      }

      setLoadError(null);
      setStale(false);
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error('Chats could not be loaded');
      const hasCachedChats = hasChatListCache(requestUserId);

      setLoadError(nextError);
      setStale(hasCachedChats);
      console.warn('Chat list load failed', {
        code: error instanceof ApiRequestError ? error.code : 'UNKNOWN',
        status: error instanceof ApiRequestError ? error.status : undefined,
        requestId: error instanceof ApiRequestError ? error.requestId : undefined,
      });
    } finally {
      if (mode !== 'silent') {
        setLoading(false);
      }

      if (mode === 'refresh') {
        setRefreshing(false);
      }

      if (mode === 'more') {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [currentUser?.id]);

  const scheduleSilentRefresh = useCallback(() => {
    if (silentRefreshTimeoutRef.current) {
      return;
    }

    silentRefreshTimeoutRef.current = setTimeout(() => {
      silentRefreshTimeoutRef.current = null;
      void loadChats('silent');
    }, 180);
  }, [loadChats]);

  const applyChatPatch = useCallback((userId: string, patch: ChatPatch) => {
    setChats((current) => patchChatList(current, userId, patch));
    setActiveChat((current) => (current?.userId === userId ? patchChat(current, patch) : current));
    setProfileChat((current) => (current?.userId === userId ? patchChat(current, patch) : current));
  }, []);

  const upsertChatState = useCallback((chat: ApiChat) => {
    setChats((current) => upsertChat(current, chat));
    setActiveChat((current) => (current?.userId === chat.userId ? chat : current));
    setProfileChat((current) => (current?.userId === chat.userId ? chat : current));
  }, []);

  useEffect(() => {
    if (!currentUser) {
      loadRequestSequenceRef.current += 1;
      chatsRef.current = [];
      setChats([]);
      setChatPageInfo({ hasMore: false, nextCursor: null });
      return;
    }

    loadRequestSequenceRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    const resetPageInfo = { hasMore: true, nextCursor: null };
    chatPageInfoRef.current = resetPageInfo;
    setChatPageInfo(resetPageInfo);
    const cachedEntry = readChatListCache(currentUser.id);

    if (cachedEntry) {
      setChats(cachedEntry.chats);
      chatPageInfoRef.current = cachedEntry.pageInfo;
      setChatPageInfo(cachedEntry.pageInfo);
      setLoading(false);
      setLoadError(null);
      setStale(cachedEntry.expiresAt <= Date.now());

      if (cachedEntry.expiresAt <= Date.now()) {
        void loadChats('silent');
      }
      return;
    }

    chatsRef.current = [];
    setChats([]);
    setLoading(true);
    void loadChats();
  }, [currentUser?.id, loadChats]);

  useEffect(() => {
    return () => {
      if (silentRefreshTimeoutRef.current) {
        clearTimeout(silentRefreshTimeoutRef.current);
        silentRefreshTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    chatsRef.current = chats;

    if (currentUser && hasChatListCache(currentUser.id)) {
      writeChatListCache(currentUser.id, chats, chatPageInfoRef.current);
    }
  }, [chats, currentUser?.id]);

  useEffect(() => {
    chatPageInfoRef.current = chatPageInfo;
  }, [chatPageInfo]);

  useEffect(() => {
    if (!activeChat) {
      return;
    }

    const nextActiveChat = chats.find((chat) => chat.userId === activeChat.userId);

    if (nextActiveChat && nextActiveChat !== activeChat) {
      setActiveChat(nextActiveChat);
    }
  }, [activeChat, chats]);

  useEffect(() => {
    if (!currentUser || !requestedOpenUserId) {
      return;
    }

    const targetUserId = requestedOpenUserId;
    const requestUserId = currentUser.id;
    let cancelled = false;

    async function openRequestedChat() {
      const existingChat = chatsRef.current.find((chat) => chat.userId === targetUserId);

      if (existingChat) {
        if (!cancelled) {
          setActiveChat(existingChat);
        }

        onRequestedOpenUserIdHandled?.(targetUserId);
        return;
      }

      let thread: Awaited<ReturnType<typeof preloadChatThread>> = null;

      try {
        thread = await preloadChatThread(requestUserId, targetUserId);
      } catch (error) {
        if (!cancelled) {
          Alert.alert(
            t('chat.screen.error.openTitle'),
            error instanceof ApiRequestError ? t(error.userMessageKey as never) : t('chat.screen.error.openDescription'),
          );
        }
      }

      if (cancelled) {
        return;
      }

      if (thread?.chat) {
        setChats((current) => upsertChat(current, thread.chat));
        setActiveChat(thread.chat);
      }

      onRequestedOpenUserIdHandled?.(targetUserId);
    }

    void openRequestedChat();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, onRequestedOpenUserIdHandled, requestedOpenUserId]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const activeThreadUserId = activeChat?.userId ?? null;
    const unsubscribeUserEvent = subscribeToUserEvent(currentUser.id, 'chat_changed', (payload) => {
      const nextMessage = (payload as { message?: ApiMessage } | null)?.message;

      if (!nextMessage) {
        scheduleSilentRefresh();
        return;
      }

      const otherUserId =
        nextMessage.sender_id === currentUser.id ? nextMessage.receiver_id : nextMessage.sender_id;
      const hasChat = chatsRef.current.some((chat) => chat.userId === otherUserId);

      setChats((current) => {
        return applyMessageInsertToChats({
          chats: current,
          currentUserId: currentUser.id,
          message: nextMessage,
          activeThreadUserId,
        }).chats;
      });

      if (!hasChat) {
        scheduleSilentRefresh();
      }
    }, (status) => {
      if (status === 'SUBSCRIBED') {
        scheduleSilentRefresh();
      }
    });

    return () => {
      unsubscribeUserEvent();
    };
  }, [activeChat?.userId, currentUser?.id, scheduleSilentRefresh]);

  const newMatches = useMemo(() => {
    return chats
      .filter(
        (chat) =>
          !hasVisibleConversationActivity(chat) &&
          chat.lastMessage.trim().length === 0 &&
          !chat.isBlocked &&
          !chat.ended,
      )
      .slice(0, 8);
  }, [chats]);

  const filteredChats = useMemo(
    () => chats.filter((chat) => matchesChatFilter(chat, filter)),
    [chats, filter],
  );

  useEffect(() => {
    setTabBadge('chat', chats.filter((chat) => chat.unread).length);
  }, [chats]);

  const handleFilterPress = (nextFilter: FilterType) => {
    if (nextFilter === filter) {
      return;
    }

    setFilter(nextFilter);
  };

  const handleThreadRead = (userId: string) => {
    setChats((current) =>
      current.map((chat) => (chat.userId === userId && chat.unread ? { ...chat, unread: false } : chat)),
    );
    setActiveChat((current) =>
      current && current.userId === userId && current.unread ? { ...current, unread: false } : current,
    );
  };

  const handleToggleProfileBlock = () => {
    if (!profileChat) {
      return;
    }

    const isBlocked = profileChat.blockedByMe;
    const title = isBlocked ? t('chat.screen.block.title.remove') : t('chat.screen.block.title.add');
    const message = isBlocked
      ? t('chat.screen.block.description.remove', { name: profileChat.user.name })
      : t('chat.screen.block.description.add', { name: profileChat.user.name });

    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: isBlocked ? t('chat.screen.block.confirm.remove') : t('chat.screen.block.confirm.add'),
        style: isBlocked ? 'default' : 'destructive',
        onPress: () => {
          const previousChat = profileChat;
          const nextPatch: ChatPatch = isBlocked
            ? {
                blockedByMe: false,
                isBlocked: previousChat.blockedByOther,
                canSend: !previousChat.ended && !previousChat.blockedByOther,
                status: !previousChat.ended && !previousChat.blockedByOther ? 'active' : previousChat.status,
                lockedReason:
                  previousChat.ended || previousChat.blockedByOther
                    ? previousChat.lockedReason
                    : null,
              }
            : {
                blockedByMe: true,
                isBlocked: true,
                canSend: false,
                lockedReason: t('chat.modal.locked.default'),
              };

          setProfileBlockBusy(true);
          applyChatPatch(previousChat.userId, nextPatch);
          setProfileChat(null);

          void (async () => {
            try {
              if (isBlocked) {
                await unblockUser(previousChat.userId);
              } else {
                await blockUser(previousChat.userId);
              }

              scheduleSilentRefresh();
            } catch (error) {
              upsertChatState(previousChat);
              setProfileChat(previousChat);
              Alert.alert(
                isBlocked ? t('chat.screen.block.error.remove') : t('chat.screen.block.error.add'),
                error instanceof Error ? error.message : t('common.retry'),
              );
            } finally {
              setProfileBlockBusy(false);
            }
          })();
        },
      },
    ]);
  };

  if (loading && chats.length === 0) {
    return (
      <SafeAreaView edges={[]} style={styles.safeArea}>
        <ChatListSkeleton />
      </SafeAreaView>
    );
  }

  if (loadError && chats.length === 0 && !stale) {
    return (
      <SafeAreaView edges={[]} style={styles.safeArea}>
        <DataState
          state="fatal-error"
          title={t('data.error.title')}
          description={
            loadError instanceof ApiRequestError
              ? t(loadError.userMessageKey as never)
              : t('data.error.generic')
          }
          actionLabel={t('data.action.retry')}
          onAction={() => void loadChats('refresh')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={[]} style={styles.safeArea}>
      <FlatList
        ref={listRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <AppRefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadChats('refresh')}
          />
        }
        data={filteredChats}
        keyExtractor={(item) => item.userId}
        onViewableItemsChanged={onViewableItemsChangedRef.current}
        viewabilityConfig={viewabilityConfigRef.current}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={7}
        onEndReachedThreshold={0.45}
        onEndReached={() => {
          if (chatPageInfo.hasMore) {
            void loadChats('more');
          }
        }}
        ItemSeparatorComponent={() => <View style={styles.chatSeparator} />}
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              {stale && loadError ? (
                <DataWarningBanner
                  title={t('data.stale.title')}
                  description={
                    loadError instanceof ApiRequestError
                      ? t(loadError.userMessageKey as never)
                      : t('data.stale.description')
                  }
                  actionLabel={t('data.action.retry')}
                  onAction={() => void loadChats('refresh')}
                />
              ) : null}
              <ScreenHeader title={t('chat.screen.title')} subtitle={t('chat.screen.subtitle')} />
            </View>

            {newMatches.length > 0 && filter === 'all' ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('chat.screen.newMatches')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.matchList}>
                  {newMatches.map((chat) => {
                    const photo = chat.user.photos.find((item) => item.trim().length > 0) ?? null;

                    return (
                      <Pressable
                        key={chat.userId}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.openChat', { name: chat.user.name })}
                        onPressIn={() => {
                          if (currentUser) {
                            void preloadChatThread(currentUser.id, chat.userId);
                          }
                        }}
                        onPress={() => setActiveChat(chat)}
                        style={styles.matchItem}
                      >
                        <ChatAvatar uri={photo} size={40} bordered />
                        <Text numberOfLines={1} style={styles.matchName}>
                          {chat.user.name.split(' ')[0]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterList}>
              {filters.map((item) => {
                const active = filter === item.value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    hitSlop={6}
                    onPress={() => handleFilterPress(item.value)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon="message-text-outline"
            title={t('chat.screen.empty.title')}
            description={t('chat.screen.empty.description')}
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator color={theme.colors.primarySoft} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            currentUserId={currentUser!.id}
            presenceEnabled={visibleChatIds.has(item.userId)}
            onIntent={() => {
              if (currentUser) {
                void preloadChatThread(currentUser.id, item.userId);
              }
            }}
            onPress={() => setActiveChat(item)}
            t={t}
          />
        )}
      />

      {activeChat && currentUser ? (
        <ChatModal
          chat={activeChat}
          currentUserId={currentUser.id}
          onClose={() => setActiveChat(null)}
          onChatUpdated={scheduleSilentRefresh}
          onChatPatched={applyChatPatch}
          onChatRestored={upsertChatState}
          onThreadRead={handleThreadRead}
          onChatDeleted={(userId) => {
            setChats((current) => current.filter((chat) => chat.userId !== userId));
            setActiveChat(null);
          }}
          onProfileClick={() => {
            if (activeChat.isBlocked) {
              return;
            }

            setProfileChat(activeChat);
          }}
        />
      ) : null}

      {profileChat ? (
        <ProfileModal
          user={profileChat.user}
          matchContext={profileChat.matchContext}
          isBlocked={profileChat.blockedByMe}
          blockBusy={profileBlockBusy}
          onToggleBlock={handleToggleProfileBlock}
          onClose={() => setProfileChat(null)}
          onMovieClick={onMovieClick}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 10,
    paddingBottom: SCREEN_BOTTOM_SPACING,
    gap: 10,
  },
  loadingMore: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  loadingText: {
    color: theme.colors.textMuted,
    marginTop: 8,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  header: {
    gap: 4,
    paddingHorizontal: 12,
  },
  section: {
    gap: 8,
    paddingHorizontal: 12,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontFamily: theme.fonts.bold,
  },
  matchList: {
    gap: 10,
  },
  matchItem: {
    width: 52,
    minHeight: 60,
    alignItems: 'center',
    gap: 4,
  },
  matchName: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    maxWidth: 52,
    textAlign: 'center',
  },
  filterList: {
    gap: 6,
    paddingHorizontal: 12,
  },
  filterChip: {
    minHeight: 36,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  filterChipActive: {
    borderColor: 'transparent',
    backgroundColor: theme.colors.primary,
  },
  filterText: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  filterTextActive: {
    color: theme.colors.white,
  },
  chatList: {
    gap: 8,
    paddingHorizontal: 12,
  },
  chatSeparator: {
    height: 10,
  },
  chatRow: {
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
  chatRowPressed: {
    opacity: 0.86,
  },
  chatRowUnread: {
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
  chatBody: {
    flex: 1,
  },
  chatTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 6,
  },
  chatPrimaryColumn: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  chatMetaColumn: {
    alignItems: 'flex-end',
    gap: 5,
    minWidth: 58,
  },
  chatName: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  chatTime: {
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
  tagBase: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tagBaseText: {
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
  tagSuccess: {
    backgroundColor: theme.colors.successSurface,
  },
  tagSuccessText: {
    color: theme.colors.successText,
  },
  tagInfo: {
    backgroundColor: theme.colors.infoSurface,
  },
  tagInfoText: {
    color: theme.colors.infoText,
  },
  tagDanger: {
    backgroundColor: theme.colors.dangerSurface,
  },
  tagDangerText: {
    color: theme.colors.dangerText,
  },
});
