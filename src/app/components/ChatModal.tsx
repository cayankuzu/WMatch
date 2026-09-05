import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AccessibleModal from './ui/AccessibleModal';

import { useLocalization } from '../../context/LocalizationContext';
import {
  ApiRequestError,
  blockUser,
  deleteChat,
  endChat,
  getChatThread,
  markChatThreadRead,
  sendMessage,
  submitUserReport,
  unblockUser,
  updateChatSettings,
  type ApiChat,
  type ApiMessage,
} from '../../services/api';
import {
  cancelPendingChatMessage,
  enqueuePendingChatMessage,
  listPendingChatMessages, purgeChatOutboxForPeer,
  removePendingChatMessage,
} from '../../services/chatOutbox';
import {
  deleteChatThreadCache,
  hasChatThreadCache,
  preloadChatThread,
  readChatThreadCache,
  writeChatThreadCache,
} from '../../services/chatCache';
import { normalizeChat, patchChat, type ChatPatch } from '../../services/chatState';
import { subscribeToUserEvent } from '../../services/userEventBus';
import { triggerHaptic } from '../../services/haptics';
import { CHAT_THREAD_INITIAL_PAGE_SIZE } from '../../shared/constants';
import type { ChatSettings } from '../../shared/types';
import { theme } from '../../shared/theme';
import { validateMessageText } from '../../shared/utils/validation';
import ChatSettingsModal from './ChatSettingsModal';
import type { LocalChatMessage } from './chat/ChatMessageBubble';
import ChatComposer from './chat/ChatComposer';
import ChatThreadList from './chat/ChatThreadList';
import ChatReportForm, {
  MIN_CHAT_REPORT_DETAILS_LENGTH,
  type ChatReportReason,
} from './chat/ChatReportForm';
import useChatPresence from '../hooks/useChatPresence';
import useTransientPopup from '../hooks/useTransientPopup';
import useChatKeyboard from '../hooks/useChatKeyboard';
import TransientPopup from './ui/TransientPopup';
import ChatHeader from './chat/ChatHeader';
import {
  createOptimisticMessage,
  mergeMessagesById,
  mergeServerMessages,
  replaceOrAppendMessage,
  sortMessages,
  toLocalMessage,
} from './chat/chatMessageModel';

interface ChatModalProps {
  chat: ApiChat;
  onClose: () => void;
  currentUserId: string;
  onProfileClick?: () => void;
  onChatUpdated?: () => void;
  onChatPatched?: (userId: string, patch: ChatPatch) => void;
  onChatRestored?: (chat: ApiChat) => void;
  onThreadRead?: (userId: string) => void;
  onChatDeleted?: (userId: string) => void;
}

const TYPING_IDLE_TIMEOUT_MS = 1800;
const CHAT_BOTTOM_PROXIMITY_PX = 120;
export default function ChatModal({
  chat,
  onClose,
  currentUserId,
  onProfileClick,
  onChatUpdated,
  onChatPatched,
  onChatRestored,
  onThreadRead,
  onChatDeleted,
}: ChatModalProps) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const initialCachedThread = useMemo(() => {
    return readChatThreadCache(currentUserId, chat.userId);
  }, [chat.userId, currentUserId]);
  const [messages, setMessages] = useState<LocalChatMessage[]>(() =>
    sortMessages(initialCachedThread?.messages.map(toLocalMessage) ?? []),
  );
  const [threadChat, setThreadChat] = useState<ApiChat>(() =>
    normalizeChat(initialCachedThread?.chat ?? chat),
  );
  const [loading, setLoading] = useState(!initialCachedThread);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [threadLoadError, setThreadLoadError] = useState<ApiRequestError | Error | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(() =>
    Boolean(initialCachedThread?.pageInfo?.hasMore && initialCachedThread.pageInfo.nextCursor),
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState<ChatReportReason>('fake_profile');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [isTypingForPresence, setIsTypingForPresence] = useState(false);
  const feedback = useTransientPopup(2400);
  const listRef = useRef<FlatList<LocalChatMessage>>(null);
  const userScrolledMessagesRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const mountedRef = useRef(true);
  const syncInFlightRef = useRef(false);
  const olderMessagesInFlightRef = useRef(false);
  const olderMessagesCursorRef = useRef<string | null>(initialCachedThread?.pageInfo?.nextCursor ?? null);
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acknowledgedReadIdsRef = useRef<Set<string>>(new Set());
  const shouldBroadcastTyping = threadChat.canSend && threadChat.settings.typingIndicator && isTypingForPresence;
  const {
    androidInset: androidKeyboardInset,
    dismiss: dismissComposer,
    handleFocusChange: handleComposerFocusChange,
    handleRootLayout,
    inputRef: composerInputRef,
    visible: isKeyboardVisible,
  } = useChatKeyboard(threadChat.canSend);

  const peerPresence = useChatPresence({
    currentUserId,
    otherUserId: threadChat.userId,
    peerSettings: threadChat.peerSettings,
    isTyping: shouldBroadcastTyping,
  });

  const applyThreadPatch = (patch: ChatPatch) => {
    setThreadChat((current) => patchChat(current, patch));
    onChatPatched?.(threadChat.userId, patch);
  };

  const restoreThreadChat = (previousChat: ApiChat) => {
    setThreadChat(previousChat);
    onChatRestored?.(previousChat);
  };

  const closeReportForm = (force = false) => {
    if (reportSubmitting && !force) {
      return;
    }

    setShowReportForm(false);
    setReportReason('fake_profile');
    setReportDetails('');
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (typingIdleTimeoutRef.current) {
        clearTimeout(typingIdleTimeoutRef.current);
        typingIdleTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setThreadChat(normalizeChat(chat));
  }, [chat]);

  useEffect(() => {
    userScrolledMessagesRef.current = false;
    scrollOffsetRef.current = 0;
  }, [chat.userId]);

  useEffect(() => {
    if (!threadChat.canSend) {
      setIsTypingForPresence(false);
    }
  }, [threadChat.canSend]);

  useEffect(() => {
    let cancelled = false;

    void listPendingChatMessages(currentUserId, chat.userId)
      .then((pendingMessages) => {
        if (cancelled || !mountedRef.current || pendingMessages.length === 0) {
          return;
        }

        const pendingLocalMessages = pendingMessages.map((pending) => createOptimisticMessage({
          id: pending.clientMessageId,
          senderId: currentUserId,
          receiverId: pending.peerUserId,
          text: pending.text,
          createdAt: pending.createdAt,
          clientStatus: 'failed',
        }));
        const pendingIds = new Set(pendingLocalMessages.map((message) => message.id));
        setMessages((current) => sortMessages([
          ...current.filter((message) => !pendingIds.has(message.id)),
          ...pendingLocalMessages,
        ]));
      })
      .catch((error) => {
        console.warn('Pending chat messages could not be restored:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [chat.userId, currentUserId]);

  const scrollToLatestMessage = (animated = true) => {
    const scroll = () => listRef.current?.scrollToOffset({ offset: 0, animated });

    requestAnimationFrame(scroll);
  };

  const isNearLatestMessage = () => scrollOffsetRef.current <= CHAT_BOTTOM_PROXIMITY_PX;

  const acknowledgeThreadRead = (unreadMessages: Pick<ApiMessage, 'id'>[] = []) => {
    const unreadIds = unreadMessages
      .map((message) => message.id)
      .filter((id) => !acknowledgedReadIdsRef.current.has(id));

    if (unreadIds.length > 0) {
      const unreadIdSet = new Set(unreadIds);
      setMessages((current) =>
        current.map((message) =>
          unreadIdSet.has(message.id) ? { ...message, read: true } : message,
        ),
      );

      unreadIds.forEach((id) => {
        acknowledgedReadIdsRef.current.add(id);
      });

      void markChatThreadRead(threadChat.userId).finally(() => {
        unreadIds.forEach((id) => {
          acknowledgedReadIdsRef.current.delete(id);
        });
      });
    }

    setThreadChat((current) => ({ ...current, unread: false }));
    onThreadRead?.(threadChat.userId);
  };

  const syncThread = async (
    silently = false,
    replaceRecentPage = false,
    useWarmCache = false,
  ) => {
    if (!mountedRef.current || syncInFlightRef.current) {
      return;
    }

    syncInFlightRef.current = true;

    if (!silently) {
      setLoading(true);
    }

    try {
      const response = useWarmCache
        ? await preloadChatThread(currentUserId, chat.userId)
        : await preloadChatThread(currentUserId, chat.userId, true);

      if (!mountedRef.current || !response) {
        return;
      }

      setMessages((current) => {
        const mergedMessages = silently && !replaceRecentPage
          ? mergeMessagesById(response.messages, current)
          : mergeServerMessages(response.messages, current);

        return mergedMessages;
      });
      olderMessagesCursorRef.current = response.pageInfo?.nextCursor ?? null;
      setHasOlderMessages(Boolean(response.pageInfo?.hasMore && response.pageInfo.nextCursor));
      setThreadChat(normalizeChat(response.chat));
      writeChatThreadCache(currentUserId, chat.userId, response);

      const unreadIncoming = response.messages.filter(
        (message) => message.receiver_id === currentUserId && !message.read,
      );

      if (unreadIncoming.length > 0) {
        acknowledgeThreadRead(unreadIncoming);
        onChatUpdated?.();
      }
      setThreadLoadError(null);
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error('Chat thread could not be loaded');
      setThreadLoadError(nextError);
      console.warn('Chat thread sync failed', {
        userId: chat.userId,
        code: error instanceof ApiRequestError ? error.code : 'UNKNOWN',
        status: error instanceof ApiRequestError ? error.status : undefined,
        requestId: error instanceof ApiRequestError ? error.requestId : undefined,
      });
    } finally {
      syncInFlightRef.current = false;

      if (mountedRef.current && !silently) {
        setLoading(false);
      }
    }
  };

  const loadOlderMessages = async () => {
    if (!mountedRef.current || olderMessagesInFlightRef.current || !hasOlderMessages || messages.length === 0) {
      return;
    }

    const nextCursor = olderMessagesCursorRef.current;

    if (!nextCursor) {
      return;
    }

    olderMessagesInFlightRef.current = true;
    setLoadingOlderMessages(true);

    try {
      const response = await getChatThread(chat.userId, {
        cursor: nextCursor,
        limit: CHAT_THREAD_INITIAL_PAGE_SIZE,
      });

      if (!mountedRef.current || !response) {
        return;
      }

      setMessages((current) => {
        const mergedMessages = mergeMessagesById(response.messages, current);
        return mergedMessages;
      });
      olderMessagesCursorRef.current = response.pageInfo?.nextCursor ?? null;
      setHasOlderMessages(Boolean(response.pageInfo?.hasMore && response.pageInfo.nextCursor));
      setThreadLoadError(null);
    } catch (error) {
      feedback.showPopup(
        error instanceof ApiRequestError ? t(error.userMessageKey as never) : t('data.error.generic'),
      );
    } finally {
      olderMessagesInFlightRef.current = false;

      if (mountedRef.current) {
        setLoadingOlderMessages(false);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    userScrolledMessagesRef.current = false;
    void syncThread(Boolean(initialCachedThread), true, true);

    const handleMessageInsert = (nextMessage: ApiMessage) => {
      const isCurrentThread =
        (nextMessage.sender_id === currentUserId && nextMessage.receiver_id === chat.userId) ||
        (nextMessage.sender_id === chat.userId && nextMessage.receiver_id === currentUserId);

      if (!isCurrentThread) {
        return;
      }

      const shouldAutoScroll = isNearLatestMessage();
      setMessages((current) => replaceOrAppendMessage(current, nextMessage));
      setThreadChat((current) => ({
        ...current,
        lastMessage: nextMessage.text,
        lastMessageTime: nextMessage.created_at,
        unread: nextMessage.receiver_id === currentUserId ? false : current.unread,
      }));

      if (nextMessage.receiver_id === currentUserId && !nextMessage.read) {
        acknowledgeThreadRead([nextMessage]);
      }

      if (shouldAutoScroll) {
        scrollToLatestMessage();
      }
      onChatUpdated?.();
    };

    const unsubscribeUserEvent = subscribeToUserEvent(currentUserId, 'chat_changed', (payload) => {
      const nextMessage = (payload as { message?: ApiMessage } | null)?.message;

      if (nextMessage) {
        handleMessageInsert(nextMessage);
        return;
      }

      void syncThread(true);
    }, (status) => {
      if (status === 'SUBSCRIBED' && !cancelled) {
        void syncThread(true);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeUserEvent();
    };
  }, [chat.userId, currentUserId]);

  useEffect(() => {
    if (
      messages.length > CHAT_THREAD_INITIAL_PAGE_SIZE ||
      !hasChatThreadCache(currentUserId, chat.userId)
    ) {
      return;
    }

    writeChatThreadCache(currentUserId, chat.userId, {
      chat: threadChat,
      messages,
      pageInfo: {
        hasMore: hasOlderMessages,
        nextCursor: olderMessagesCursorRef.current,
      },
    });
  }, [chat.userId, currentUserId, hasOlderMessages, messages, threadChat]);

  const handleComposerActivity = (text: string) => {
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }

    if (!text.trim()) {
      setIsTypingForPresence(false);
      return;
    }

    setIsTypingForPresence(true);
    typingIdleTimeoutRef.current = setTimeout(() => {
      setIsTypingForPresence(false);
      typingIdleTimeoutRef.current = null;
    }, TYPING_IDLE_TIMEOUT_MS);
  };

  const submitMessage = async (text: string, optimisticId?: string) => {
    const previousChat = threadChat;
    const localId = optimisticId ?? `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const optimisticMessage = createOptimisticMessage({
      id: localId,
      senderId: currentUserId,
      receiverId: threadChat.userId,
      text,
    });

    setMessages((current) => {
      if (optimisticId) {
        return sortMessages(
          current.map((message) => (message.id === optimisticId ? optimisticMessage : message)),
        );
      }

      return sortMessages([...current, optimisticMessage]);
    });
    setThreadChat((current) => ({
      ...current,
      lastMessage: text,
      lastMessageTime: optimisticMessage.created_at,
      hasConversationActivity: true,
    }));
    onChatPatched?.(threadChat.userId, {
      lastMessage: text,
      lastMessageTime: optimisticMessage.created_at,
      hasConversationActivity: true,
    });
    scrollToLatestMessage();

    try {
      await enqueuePendingChatMessage(currentUserId, {
        clientMessageId: localId,
        peerUserId: threadChat.userId,
        text,
        createdAt: optimisticMessage.created_at,
      });
      const createdMessage = await sendMessage(threadChat.userId, text, localId);
      await removePendingChatMessage(currentUserId, localId);

      if (!mountedRef.current) {
        return;
      }

      setMessages((current) => replaceOrAppendMessage(current, createdMessage, localId));
      setThreadChat((current) => ({
        ...current,
        lastMessage: createdMessage.text,
        lastMessageTime: createdMessage.created_at,
        hasConversationActivity: true,
      }));
      onChatPatched?.(threadChat.userId, {
        lastMessage: createdMessage.text,
        lastMessageTime: createdMessage.created_at,
        hasConversationActivity: true,
      });
      onChatUpdated?.();
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === localId ? { ...message, clientStatus: 'failed' } : message,
        ),
      );
      restoreThreadChat(previousChat);
      triggerHaptic('error');

      feedback.showPopup(t('chat.modal.alert.sendFailed.fallback'));
    }
  };

  const handleSend = (text: string) => {
    if (!threadChat.canSend) {
      feedback.showPopup(threadChat.lockedReason ?? t('chat.modal.locked.default'));
      return false;
    }

    const validationMessage = validateMessageText(text);
    if (validationMessage) {
      feedback.showPopup(validationMessage);
      return false;
    }

    triggerHaptic('selection');
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }
    setIsTypingForPresence(false);
    dismissComposer();
    void submitMessage(text);
    return true;
  };

  const handleRetryMessage = (message: LocalChatMessage) => {
    if (message.clientStatus !== 'failed') {
      return;
    }

    void submitMessage(message.text, message.id);
  };

  const handleCancelFailedMessage = async (message: LocalChatMessage) => {
    try {
      await cancelPendingChatMessage(currentUserId, message.id);

      if (mountedRef.current) {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      }
    } catch (error) {
      feedback.showPopup(t('chat.modal.retry.cancelFailedDescription'));
    }
  };

  const handleFailedMessagePress = (message: LocalChatMessage) => {
    if (message.clientStatus !== 'failed') {
      return;
    }

    Alert.alert(
      t('chat.modal.retry.title'),
      t('chat.modal.retry.description'),
      [
        {
          text: t('chat.modal.retry.cancel'),
          style: 'destructive',
          onPress: () => void handleCancelFailedMessage(message),
        },
        {
          text: t('chat.modal.retry.resend'),
          onPress: () => handleRetryMessage(message),
        },
      ],
    );
  };

  const handleSettingsChange = async (nextSettings: ChatSettings) => {
    const previousSettings = threadChat.settings;

    setThreadChat((current) => ({
      ...current,
      settings: nextSettings,
    }));
    onChatPatched?.(threadChat.userId, { settings: nextSettings });
    setSavingSettings(true);

    try {
      const savedSettings = await updateChatSettings(threadChat.userId, nextSettings);

      if (!mountedRef.current) {
        return;
      }

      setThreadChat((current) => ({
        ...current,
        settings: savedSettings,
      }));
      onChatPatched?.(threadChat.userId, { settings: savedSettings });
      onChatUpdated?.();
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setThreadChat((current) => ({
        ...current,
        settings: previousSettings,
      }));
      onChatPatched?.(threadChat.userId, { settings: previousSettings });

      feedback.showPopup(t('chat.modal.alert.settingsFailed'));
    } finally {
      if (mountedRef.current) {
        setSavingSettings(false);
      }
    }
  };

  const refreshAfterMutation = () => {
    void syncThread(true);
    onChatUpdated?.();
  };

  const handleEndConversation = () => {
    if (threadChat.ended || actionBusy) {
      return;
    }

    Alert.alert(
      t('chat.modal.alert.end.title'),
      t('chat.modal.alert.end.description'),
      [
        { text: t('chat.modal.alert.cancel'), style: 'cancel' },
        {
          text: t('chat.modal.alert.end.confirm'),
          style: 'destructive',
          onPress: async () => {
            const previousChat = threadChat;
            const endedPatch: ChatPatch = {
              status: 'ended',
              ended: true,
              canSend: false,
              lockedReason: t('chat.modal.locked.default'),
            };

            setActionBusy(true);
            setShowMenu(false);
            applyThreadPatch(endedPatch);

            try {
              await endChat(currentUserId, threadChat.userId);
              await purgeChatOutboxForPeer(currentUserId, threadChat.userId);
              refreshAfterMutation();
            } catch (error) {
              restoreThreadChat(previousChat);
              feedback.showPopup(t('chat.modal.alert.end.failed'));
            } finally {
              if (mountedRef.current) {
                setActionBusy(false);
              }
            }
          },
        },
      ],
    );
  };

  const executeDeleteFlow = async (mode: 'end' | 'block') => {
    const previousChat = threadChat;
    const targetUserId = threadChat.userId;

    setActionBusy(true);
    setShowMenu(false);
    deleteChatThreadCache(currentUserId, chat.userId);
    onChatDeleted?.(targetUserId);
    onClose();

    try {
      await deleteChat(targetUserId, mode);
      await purgeChatOutboxForPeer(currentUserId, targetUserId);
      onChatUpdated?.();
    } catch (error) {
      onChatRestored?.(previousChat);
      feedback.showPopup(t('chat.modal.alert.action.failed'));
    } finally {
      if (mountedRef.current) {
        setActionBusy(false);
      }
    }
  };

  const handleHideConversation = () => {
    if (actionBusy) {
      return;
    }

    Alert.alert(t('chat.modal.alert.delete.title'), t('chat.modal.alert.delete.description'), [
      { text: t('chat.modal.alert.cancel'), style: 'cancel' },
      {
        text: t('chat.modal.alert.delete.endAndRemove'),
        style: 'destructive',
        onPress: () => {
          void executeDeleteFlow('end');
        },
      },
      {
        text: t('chat.modal.alert.delete.blockAndRemove'),
        style: 'destructive',
        onPress: () => {
          void executeDeleteFlow('block');
        },
      },
    ]);
  };

  const handleToggleBlock = () => {
    if (actionBusy) {
      return;
    }

    const isBlockedByMe = threadChat.blockedByMe;
    const title = isBlockedByMe ? t('chat.modal.alert.block.removeTitle') : t('chat.modal.alert.block.addTitle');
    const message = isBlockedByMe
      ? t('chat.modal.alert.block.removeDescription')
      : t('chat.modal.alert.block.addDescription', { name: threadChat.user.name });

    Alert.alert(title, message, [
      { text: t('chat.modal.alert.cancel'), style: 'cancel' },
      {
        text: isBlockedByMe ? t('chat.modal.alert.block.removeConfirm') : t('chat.modal.alert.block.addConfirm'),
        style: isBlockedByMe ? 'default' : 'destructive',
        onPress: async () => {
          const previousChat = threadChat;
          const nextPatch: ChatPatch = isBlockedByMe
            ? {
                blockedByMe: false,
                isBlocked: threadChat.blockedByOther,
                canSend: !threadChat.ended && !threadChat.blockedByOther,
                status: !threadChat.ended && !threadChat.blockedByOther ? 'active' : threadChat.status,
                lockedReason:
                  threadChat.ended || threadChat.blockedByOther
                    ? threadChat.lockedReason
                    : null,
              }
            : {
                blockedByMe: true,
                isBlocked: true,
                canSend: false,
                lockedReason: t('chat.modal.locked.default'),
              };

          setActionBusy(true);
          setShowMenu(false);
          applyThreadPatch(nextPatch);

          try {
            if (isBlockedByMe) {
              await unblockUser(threadChat.userId);
            } else {
              await blockUser(threadChat.userId);
              await purgeChatOutboxForPeer(currentUserId, threadChat.userId);
            }

            refreshAfterMutation();
          } catch (error) {
            restoreThreadChat(previousChat);
            feedback.showPopup(
              isBlockedByMe ? t('chat.modal.alert.block.removeFailed') : t('chat.modal.alert.block.addFailed'),
            );
          } finally {
            if (mountedRef.current) {
              setActionBusy(false);
            }
          }
        },
      },
    ]);
  };

  const handleReportSubmit = async () => {
    const normalizedDetails = reportDetails.trim();

    if (normalizedDetails.length < MIN_CHAT_REPORT_DETAILS_LENGTH) {
      Alert.alert(t('profile.report.validation.title'), t('profile.report.validation.detailsMin'));
      return;
    }

    setReportSubmitting(true);

    try {
      await submitUserReport({
        targetUserId: threadChat.userId,
        reasonCode: reportReason,
        details: normalizedDetails,
        matchContext: threadChat.matchContext ?? null,
        clientContext: {
          platform: Platform.OS,
          appVersion: Application.nativeApplicationVersion ?? null,
          buildVersion: Application.nativeBuildVersion ?? null,
          blockedByReporter: threadChat.blockedByMe,
          reportedFrom: 'chat_modal',
          reportedAt: new Date().toISOString(),
        },
      });

      closeReportForm(true);
      feedback.showPopup(t('profile.report.successDescription'));
    } catch (error) {
      feedback.showPopup(t('profile.report.errorDescription'));
    } finally {
      if (mountedRef.current) {
        setReportSubmitting(false);
      }
    }
  };

  const composerBottomPadding =
    Platform.OS === 'ios'
      ? Math.max(insets.bottom, 10)
      : isKeyboardVisible
        ? 8
        : Math.max(insets.bottom, 10);
  const androidComposerPadding =
    Platform.OS === 'android' && isKeyboardVisible ? androidKeyboardInset : 0;
  return (
    <AccessibleModal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        accessibilityViewIsModal
        importantForAccessibility="yes"
        style={[
          styles.container,
          androidComposerPadding > 0
            ? { paddingBottom: androidComposerPadding }
            : null,
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={Platform.OS === 'ios'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 6 : 0}
        onLayout={handleRootLayout}
      >
        <SafeAreaView edges={['top', 'right', 'left']} style={styles.safeArea}>
          <ChatHeader
            chat={threadChat}
            menuVisible={showMenu}
            peerOnline={peerPresence.isOnline}
            peerTyping={peerPresence.isTyping}
            onBack={onClose}
            onDelete={handleHideConversation}
            onEnd={handleEndConversation}
            onOpenProfile={() => {
              if (threadChat.isBlocked) {
                feedback.showPopup(t('chat.modal.profile.hidden.description'));
                return;
              }
              onProfileClick?.();
            }}
            onOpenReport={() => {
              setShowMenu(false);
              setShowReportForm(true);
            }}
            onOpenSettings={() => {
              setShowMenu(false);
              setShowSettings(true);
            }}
            onToggleBlock={handleToggleBlock}
            onToggleMenu={() => setShowMenu((value) => !value)}
          />

          <ChatThreadList
            ref={listRef}
            canSend={threadChat.canSend}
            currentUserId={currentUserId}
            failedLabel={t('chat.modal.retry.failed')}
            loading={loading}
            loadingOlder={loadingOlderMessages}
            messages={messages}
            peerReadReceipts={threadChat.peerSettings.readReceipts}
            threadError={threadLoadError}
            onDismissComposer={dismissComposer}
            onFailedMessagePress={handleFailedMessagePress}
            onLoadOlder={() => {
              if (userScrolledMessagesRef.current && !loading && !loadingOlderMessages) {
                void loadOlderMessages();
              }
            }}
            onRetry={() => void syncThread(false)}
            onScrollOffset={(offset) => {
              scrollOffsetRef.current = offset;
            }}
            onUserScroll={() => {
              userScrolledMessagesRef.current = true;
            }}
          />

          {threadChat.canSend ? (
            <ChatComposer
              key={threadChat.userId}
              ref={composerInputRef}
              bottomPadding={composerBottomPadding}
              onFocusChange={handleComposerFocusChange}
              onSend={handleSend}
              onTextActivity={handleComposerActivity}
            />
          ) : (
            <View style={[styles.inputSafeArea, { paddingBottom: composerBottomPadding }]}>
              <View
                style={[
                  styles.lockedNotice,
                  threadChat.isBlocked ? styles.lockedNoticeDanger : styles.lockedNoticeMuted,
                ]}
              >
                <MaterialCommunityIcons
                  name={threadChat.isBlocked ? 'block-helper' : 'message-lock-outline'}
                  size={18}
                  color={threadChat.isBlocked ? theme.colors.dangerText : theme.colors.textMuted}
                />
                <Text style={styles.lockedText}>
                  {threadChat.lockedReason ?? t('chat.modal.locked.default')}
                </Text>
              </View>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {showSettings ? (
        <ChatSettingsModal
          value={threadChat.settings}
          saving={savingSettings}
          onClose={() => setShowSettings(false)}
          onChange={(nextSettings) => {
            void handleSettingsChange(nextSettings);
          }}
        />
      ) : null}

      <ChatReportForm
        visible={showReportForm}
        reason={reportReason}
        details={reportDetails}
        submitting={reportSubmitting}
        onReasonChange={setReportReason}
        onDetailsChange={setReportDetails}
        onSubmit={() => void handleReportSubmit()}
        onClose={closeReportForm}
      />
      <TransientPopup
        message={feedback.message}
        icon="information-outline"
        bottomOffset={composerBottomPadding + 54}
      />
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  inputSafeArea: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  lockedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 8,
    marginVertical: 10,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  lockedNoticeMuted: {
    backgroundColor: theme.colors.surface,
  },
  lockedNoticeDanger: {
    backgroundColor: theme.colors.dangerSurface,
  },
  lockedText: {
    flex: 1,
    color: theme.colors.text,
    ...theme.typography.roles.body,
  },
});
