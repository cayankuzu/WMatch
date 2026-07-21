import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AccessibleModal from './ui/AccessibleModal';
import AppModal from './ui/AppModal';

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
  enqueuePendingChatMessage,
  listPendingChatMessages,
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
import { CHAT_THREAD_INITIAL_PAGE_SIZE, MAX_MESSAGE_LENGTH } from '../../shared/constants';
import type { ChatSettings } from '../../shared/types';
import { theme } from '../../shared/theme';
import { calculateKeyboardInset } from '../../shared/utils/keyboard';
import {
  clampMessageText,
  countMessageCharacters,
  validateMessageText,
} from '../../shared/utils/validation';
import AppButton from './ui/AppButton';
import ChatSettingsModal from './ChatSettingsModal';
import ChatMessageBubble, { type LocalChatMessage } from './chat/ChatMessageBubble';
import TypingDots from './chat/TypingDots';
import useChatPresence from '../hooks/useChatPresence';
import DataState from './ui/DataState';
import { MessageThreadSkeleton } from './ui/Skeleton';
import ChatAvatar from './chat/ChatAvatar';
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

const REPORT_REASON_OPTIONS = [
  'fake_profile',
  'harassment',
  'spam',
  'nudity',
  'underage',
  'hate_speech',
  'other',
] as const;

type ReportReasonCode = (typeof REPORT_REASON_OPTIONS)[number];

const MIN_REPORT_DETAILS_LENGTH = 20;
const MAX_REPORT_DETAILS_LENGTH = 1500;
const TYPING_IDLE_TIMEOUT_MS = 1800;
const CHAT_BOTTOM_PROXIMITY_PX = 120;
const CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION = { minIndexForVisible: 0 } as const;
const ANDROID_KEYBOARD_COMPOSER_GAP = 32;

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
  const [inputText, setInputText] = useState('');
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
  const [reportReason, setReportReason] = useState<ReportReasonCode>('fake_profile');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [androidKeyboardInset, setAndroidKeyboardInset] = useState(0);
  const [isTypingForPresence, setIsTypingForPresence] = useState(false);
  const listRef = useRef<FlatList<LocalChatMessage>>(null);
  const composerInputRef = useRef<TextInput>(null);
  const rootHeightRef = useRef(0);
  const rootHeightWithoutKeyboardRef = useRef(0);
  const androidKeyboardHeightRef = useRef(0);
  const userScrolledMessagesRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const mountedRef = useRef(true);
  const syncInFlightRef = useRef(false);
  const olderMessagesInFlightRef = useRef(false);
  const olderMessagesCursorRef = useRef<string | null>(initialCachedThread?.pageInfo?.nextCursor ?? null);
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acknowledgedReadIdsRef = useRef<Set<string>>(new Set());
  const shouldBroadcastTyping = threadChat.canSend && isTypingForPresence;
  const messageCharacterCount = countMessageCharacters(inputText);

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
      if (keyboardResetTimeoutRef.current) {
        clearTimeout(keyboardResetTimeoutRef.current);
        keyboardResetTimeoutRef.current = null;
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

  useEffect(() => {
    if (!threadChat.canSend) {
      setIsComposerFocused(false);
      setIsKeyboardVisible(false);
      androidKeyboardHeightRef.current = 0;
      setAndroidKeyboardInset(0);
      setIsTypingForPresence(false);
      return;
    }

    const syncAndroidKeyboardInset = (keyboardHeight: number) => {
      if (Platform.OS !== 'android') {
        return;
      }

      const nextInset = calculateKeyboardInset(
        rootHeightWithoutKeyboardRef.current,
        rootHeightRef.current,
        keyboardHeight,
        ANDROID_KEYBOARD_COMPOSER_GAP,
      );
      setAndroidKeyboardInset((current) => (current === nextInset ? current : nextInset));
    };

    const handleKeyboardShown = (event: KeyboardEvent) => {
      if (mountedRef.current) {
        if (keyboardResetTimeoutRef.current) {
          clearTimeout(keyboardResetTimeoutRef.current);
          keyboardResetTimeoutRef.current = null;
        }
        setIsKeyboardVisible(true);

        if (Platform.OS === 'android') {
          const measuredKeyboardHeight = Keyboard.metrics()?.height ?? 0;
          const keyboardHeight = Math.max(event.endCoordinates.height, measuredKeyboardHeight, 0);
          androidKeyboardHeightRef.current = keyboardHeight;
          syncAndroidKeyboardInset(keyboardHeight);
        }
      }
    };

    const handleKeyboardHidden = () => {
      if (mountedRef.current) {
        if (keyboardResetTimeoutRef.current) {
          clearTimeout(keyboardResetTimeoutRef.current);
          keyboardResetTimeoutRef.current = null;
        }
        setIsKeyboardVisible(false);
        androidKeyboardHeightRef.current = 0;
        setAndroidKeyboardInset(0);
      }
    };

    const keyboardShowSubscription = Keyboard.addListener('keyboardDidShow', handleKeyboardShown);
    const keyboardHideSubscription = Keyboard.addListener('keyboardDidHide', handleKeyboardHidden);

    return () => {
      keyboardShowSubscription.remove();
      keyboardHideSubscription.remove();
    };
  }, [threadChat.canSend]);

  const handleRootLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    rootHeightRef.current = height;

    if (Platform.OS !== 'android') {
      return;
    }

    const keyboardHeight = androidKeyboardHeightRef.current;
    if (keyboardHeight <= 0) {
      rootHeightWithoutKeyboardRef.current = height;
      return;
    }

    const nextInset = calculateKeyboardInset(
      rootHeightWithoutKeyboardRef.current,
      height,
      keyboardHeight,
      ANDROID_KEYBOARD_COMPOSER_GAP,
    );
    setAndroidKeyboardInset((current) => (current === nextInset ? current : nextInset));
  };

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
      setMessages((current) =>
        current.map((message) =>
          unreadIds.includes(message.id) ? { ...message, read: true } : message,
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
      Alert.alert(
        t('data.error.title'),
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

  const handleInputChange = (nextValue: string) => {
    const clampedValue = clampMessageText(nextValue);
    setInputText(clampedValue);

    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }

    if (!clampedValue.trim()) {
      setIsTypingForPresence(false);
      return;
    }

    setIsTypingForPresence(true);
    typingIdleTimeoutRef.current = setTimeout(() => {
      setIsTypingForPresence(false);
      typingIdleTimeoutRef.current = null;
    }, TYPING_IDLE_TIMEOUT_MS);
  };

  const dismissComposer = () => {
    if (!isComposerFocused && !isKeyboardVisible) {
      return;
    }

    composerInputRef.current?.blur();
    Keyboard.dismiss();
    setIsComposerFocused(false);

    if (keyboardResetTimeoutRef.current) {
      clearTimeout(keyboardResetTimeoutRef.current);
    }
    keyboardResetTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setIsKeyboardVisible(false);
        androidKeyboardHeightRef.current = 0;
        setAndroidKeyboardInset(0);
      }
      keyboardResetTimeoutRef.current = null;
    }, 350);
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

      Alert.alert(
        t('chat.modal.alert.sendFailed.title'),
        error instanceof Error ? error.message : t('chat.modal.alert.sendFailed.fallback'),
      );
    }
  };

  const handleSend = async () => {
    const text = inputText.trim();

    if (!threadChat.canSend) {
      Alert.alert(t('chat.modal.alert.cannotSend.title'), threadChat.lockedReason ?? t('chat.modal.locked.default'));
      return;
    }

    const validationMessage = validateMessageText(text);
    if (validationMessage) {
      Alert.alert(t('chat.modal.alert.sendFailed.title'), validationMessage);
      return;
    }

    setInputText('');
    triggerHaptic('selection');
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }
    setIsTypingForPresence(false);
    dismissComposer();
    await submitMessage(text);
  };

  const handleRetryMessage = (message: LocalChatMessage) => {
    if (message.clientStatus !== 'failed') {
      return;
    }

    void submitMessage(message.text, message.id);
  };

  const handleCancelFailedMessage = async (message: LocalChatMessage) => {
    try {
      await removePendingChatMessage(currentUserId, message.id);

      if (mountedRef.current) {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      }
    } catch (error) {
      Alert.alert(
        t('chat.modal.retry.cancelFailedTitle'),
        error instanceof Error ? error.message : t('chat.modal.retry.cancelFailedDescription'),
      );
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

      Alert.alert(
        t('chat.modal.alert.settingsFailed'),
        error instanceof Error ? error.message : t('chat.modal.alert.sendFailed.fallback'),
      );
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
              refreshAfterMutation();
            } catch (error) {
              restoreThreadChat(previousChat);
              Alert.alert(
                t('chat.modal.alert.end.failed'),
                error instanceof Error ? error.message : t('chat.modal.alert.sendFailed.fallback'),
              );
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
      onChatUpdated?.();
    } catch (error) {
      onChatRestored?.(previousChat);
      Alert.alert(
        t('chat.modal.alert.action.failed'),
        error instanceof Error ? error.message : t('chat.modal.alert.sendFailed.fallback'),
      );
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
            }

            refreshAfterMutation();
          } catch (error) {
            restoreThreadChat(previousChat);
            Alert.alert(
              isBlockedByMe ? t('chat.modal.alert.block.removeFailed') : t('chat.modal.alert.block.addFailed'),
              error instanceof Error ? error.message : t('chat.modal.alert.sendFailed.fallback'),
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

    if (normalizedDetails.length < MIN_REPORT_DETAILS_LENGTH) {
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
      Alert.alert(t('profile.report.successTitle'), t('profile.report.successDescription'));
    } catch (error) {
      Alert.alert(
        t('profile.report.errorTitle'),
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('profile.report.errorDescription'),
      );
    } finally {
      if (mountedRef.current) {
        setReportSubmitting(false);
      }
    }
  };

  const photo = threadChat.user.photos.find((item) => item.trim().length > 0) ?? null;
  const showLoadingSkeleton = loading && messages.length === 0;
  const showThreadError = !loading && messages.length === 0 && threadLoadError != null;
  const showPlaceholder = !loading && messages.length === 0 && !showThreadError;
  const composerBottomPadding =
    Platform.OS === 'ios'
      ? Math.max(insets.bottom, 10)
      : isKeyboardVisible
        ? 8
        : Math.max(insets.bottom, 10);
  const androidComposerPadding =
    Platform.OS === 'android' && isKeyboardVisible ? androidKeyboardInset : 0;
  const statusContent = useMemo(() => {
    if (threadChat.ended) {
      return null;
    }

    if (peerPresence.isTyping) {
      return <TypingDots label={t('chat.modal.header.typing')} />;
    }

    if (!threadChat.peerSettings.onlineStatus) {
      return null;
    }

    return (
      <Text
        numberOfLines={2}
        style={[styles.statusText, peerPresence.isOnline ? styles.statusTextOnline : styles.statusTextOffline]}
      >
        {peerPresence.isOnline ? t('chat.modal.header.online') : t('chat.modal.header.offline')}
      </Text>
    );
  }, [peerPresence.isOnline, peerPresence.isTyping, t, threadChat.ended, threadChat.peerSettings.onlineStatus, threadChat.peerSettings.typingIndicator]);

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
          <View accessibilityViewIsModal style={styles.header}>
            <View style={styles.headerLeft}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                hitSlop={6}
                onPress={onClose}
                style={styles.iconButton}
              >
                <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.text} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('a11y.openProfile', { name: threadChat.user.name })}
                accessibilityState={{ disabled: threadChat.isBlocked }}
                disabled={threadChat.isBlocked}
                onPress={() => {
                  if (threadChat.isBlocked) {
                    Alert.alert(
                      t('chat.modal.profile.hidden.title'),
                      t('chat.modal.profile.hidden.description'),
                    );
                    return;
                  }

                  onProfileClick?.();
                }}
                style={styles.profileButton}
              >
                <ChatAvatar uri={photo} size={34} />

                <View style={styles.profileText}>
                  <Text numberOfLines={2} style={styles.name}>
                    {threadChat.user.name}
                  </Text>
                  <Text numberOfLines={2} style={styles.username}>
                    {threadChat.user.username}
                  </Text>
                  {statusContent}
                </View>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('a11y.chatMenu')}
              accessibilityState={{ expanded: showMenu }}
              hitSlop={6}
              onPress={() => setShowMenu((value) => !value)}
              style={styles.iconButton}
            >
              <MaterialCommunityIcons name="dots-vertical" size={18} color={theme.colors.text} />
            </Pressable>
          </View>

          {showMenu ? (
            <View accessibilityRole="menu" style={styles.menu}>
              <Pressable
                accessibilityRole="menuitem"
                onPress={() => {
                  setShowMenu(false);
                  setShowSettings(true);
                }}
                style={styles.menuItem}
              >
                <MaterialCommunityIcons name="tune-variant" size={16} color={theme.colors.info} />
                <Text style={styles.menuText}>{t('chat.modal.menu.settings')}</Text>
              </Pressable>

              {!threadChat.ended && !threadChat.isBlocked ? (
                <Pressable accessibilityRole="menuitem" onPress={handleEndConversation} style={styles.menuItem}>
                  <MaterialCommunityIcons name="message-lock-outline" size={16} color={theme.colors.warning} />
                  <Text style={[styles.menuText, styles.menuTextWarning]}>{t('chat.modal.menu.endMatch')}</Text>
                </Pressable>
              ) : null}

              <Pressable accessibilityRole="menuitem" onPress={handleHideConversation} style={styles.menuItem}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color={theme.colors.dangerText} />
                  <Text style={[styles.menuText, styles.menuTextDanger]}>{t('chat.modal.menu.delete')}</Text>
              </Pressable>

              <Pressable
                accessibilityRole="menuitem"
                onPress={() => {
                  setShowMenu(false);
                  setShowReportForm(true);
                }}
                style={styles.menuItem}
              >
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={theme.colors.dangerText} />
                <Text style={[styles.menuText, styles.menuTextDanger]}>{t('profile.menu.report.label')}</Text>
              </Pressable>

              {threadChat.blockedByMe ? (
                <Pressable accessibilityRole="menuitem" onPress={handleToggleBlock} style={styles.menuItem}>
                  <MaterialCommunityIcons name="lock-open-variant-outline" size={16} color={theme.colors.info} />
                  <Text style={styles.menuText}>{t('chat.modal.menu.unblock')}</Text>
                </Pressable>
              ) : !threadChat.blockedByOther ? (
                <Pressable accessibilityRole="menuitem" onPress={handleToggleBlock} style={styles.menuItem}>
                  <MaterialCommunityIcons name="block-helper" size={16} color={theme.colors.dangerText} />
                  <Text style={[styles.menuText, styles.menuTextDanger]}>{t('chat.modal.menu.block')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <FlatList
            ref={listRef}
            data={messages}
            inverted
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.messages,
              (showPlaceholder || showThreadError) && styles.messagesEmpty,
              showLoadingSkeleton && styles.messagesLoading,
            ]}
            keyboardShouldPersistTaps="never"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            initialNumToRender={CHAT_THREAD_INITIAL_PAGE_SIZE}
            maxToRenderPerBatch={12}
            windowSize={7}
            maintainVisibleContentPosition={CHAT_MAINTAIN_VISIBLE_CONTENT_POSITION}
            onTouchStart={dismissComposer}
            onScrollBeginDrag={() => {
              userScrolledMessagesRef.current = true;
              dismissComposer();
            }}
            onScroll={(event) => {
              scrollOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y);
            }}
            onEndReached={() => {
              if (userScrolledMessagesRef.current && !loading && !loadingOlderMessages) {
                void loadOlderMessages();
              }
            }}
            onEndReachedThreshold={0.2}
            scrollEventThrottle={32}
            ListFooterComponent={
              loadingOlderMessages ? (
                <View style={styles.loadingOlder}>
                  <ActivityIndicator color={theme.colors.primarySoft} />
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const isOwn = item.sender_id === currentUserId;

              return (
                <View style={[styles.messageRow, isOwn ? styles.messageRowOwn : styles.messageRowOther]}>
                  <ChatMessageBubble
                    message={item}
                    isOwn={isOwn}
                    canShowReadReceipt={threadChat.peerSettings.readReceipts}
                    failedLabel={t('chat.modal.retry.failed')}
                    onFailedPress={isOwn ? () => handleFailedMessagePress(item) : undefined}
                  />
                </View>
              );
            }}
            ListEmptyComponent={
              showLoadingSkeleton ? (
                <MessageThreadSkeleton />
              ) : showThreadError ? (
                <DataState
                  state="fatal-error"
                  title={t('data.error.title')}
                  description={
                    threadLoadError instanceof ApiRequestError
                      ? t(threadLoadError.userMessageKey as never)
                      : t('data.error.generic')
                  }
                  actionLabel={t('data.action.retry')}
                  onAction={() => void syncThread(false)}
                />
              ) : showPlaceholder ? (
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}>
                    <MaterialCommunityIcons name="heart" size={22} color={theme.colors.primarySoft} />
                  </View>
                  <Text style={styles.emptyTitle}>{t('chat.modal.empty.title')}</Text>
                  <Text style={styles.emptyDescription}>
                    {threadChat.canSend ? t('chat.modal.empty.description.start') : t('chat.modal.empty.description.locked')}
                  </Text>
                </View>
              ) : null
            }
          />

          {threadChat.canSend ? (
            <View
              style={[styles.inputSafeArea, { paddingBottom: composerBottomPadding }]}
            >
              <View style={styles.inputRow}>
                <TextInput
                  ref={composerInputRef}
                  value={inputText}
                  onChangeText={handleInputChange}
                  onFocus={() => {
                    setIsComposerFocused(true);
                  }}
                  onBlur={() => {
                    setIsComposerFocused(false);
                  }}
                  placeholder={t('chat.modal.input.placeholder')}
                  accessibilityLabel={t('chat.modal.input.placeholder')}
                  placeholderTextColor={theme.colors.textSoft}
                  style={styles.input}
                  returnKeyType="send"
                  onSubmitEditing={() => void handleSend()}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y.sendMessage')}
                  accessibilityState={{ disabled: !inputText.trim() }}
                  hitSlop={6}
                  onPress={() => void handleSend()}
                  disabled={!inputText.trim()}
                  style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
                >
                  <MaterialCommunityIcons name="send" size={16} color={theme.colors.white} />
                </Pressable>
              </View>
              {messageCharacterCount >= Math.floor(MAX_MESSAGE_LENGTH * 0.8) ? (
                <Text style={styles.messageCounter}>
                  {messageCharacterCount}/{MAX_MESSAGE_LENGTH}
                </Text>
              ) : null}
            </View>
          ) : (
            <View
              style={[styles.inputSafeArea, { paddingBottom: composerBottomPadding }]}
            >
              <View style={[styles.lockedNotice, threadChat.isBlocked ? styles.lockedNoticeDanger : styles.lockedNoticeMuted]}>
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

      <AppModal
        visible={showReportForm}
        title={t('profile.report.sheet.title')}
        presentation="sheet"
        keyboardAware
        scrollable
        onClose={closeReportForm}
      >
              <Text style={styles.reportSubtitle}>{t('profile.report.sheet.description')}</Text>

              <View style={styles.reasonGrid}>
                {REPORT_REASON_OPTIONS.map((reason) => {
                  const selected = reportReason === reason;

                  return (
                    <Pressable
                      key={reason}
                      accessibilityRole="radio"
                      accessibilityLabel={t(`profile.report.reason.${reason}`)}
                      accessibilityState={{ checked: selected }}
                      onPress={() => setReportReason(reason)}
                      style={[styles.reasonChip, selected && styles.reasonChipActive]}
                    >
                      <Text style={[styles.reasonChipText, selected && styles.reasonChipTextActive]}>
                        {t(`profile.report.reason.${reason}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.detailsSection}>
                <Text style={styles.detailsLabel}>{t('profile.report.detailsLabel')}</Text>
                <TextInput
                  multiline
                  maxLength={MAX_REPORT_DETAILS_LENGTH}
                  editable={!reportSubmitting}
                  accessibilityLabel={t('profile.report.detailsLabel')}
                  accessibilityHint={t('profile.report.detailsPlaceholder')}
                  placeholder={t('profile.report.detailsPlaceholder')}
                  placeholderTextColor={theme.colors.textSoft}
                  style={styles.detailsInput}
                  textAlignVertical="top"
                  value={reportDetails}
                  onChangeText={setReportDetails}
                />
                <Text style={styles.detailsCounter}>
                  {reportDetails.trim().length}/{MAX_REPORT_DETAILS_LENGTH}
                </Text>
              </View>

              <View style={styles.reportActions}>
                <AppButton title={t('profile.report.submit')} onPress={() => void handleReportSubmit()} loading={reportSubmitting} />
                <AppButton title={t('common.cancel')} onPress={closeReportForm} variant="secondary" />
              </View>
      </AppModal>
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
  loadingOlder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  header: {
    minHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  iconButton: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.fonts.bold,
  },
  username: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.medium,
  },
  statusText: {
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  statusTextOnline: {
    color: theme.colors.successText,
  },
  statusTextOffline: {
    color: theme.colors.textSoft,
  },
  menu: {
    position: 'absolute',
    top: 76,
    right: 12,
    zIndex: 20,
    minWidth: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  menuItem: {
    minHeight: theme.layout.controlMinUnified,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuText: {
    color: theme.colors.text,
    ...theme.typography.roles.meta,
  },
  menuTextDanger: {
    color: theme.colors.dangerText,
  },
  menuTextWarning: {
    color: theme.colors.warningText,
  },
  reportOverlay: {
    zIndex: 24,
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.scrim,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  reportCard: {
    maxHeight: '82%',
    borderRadius: theme.radius.personCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  reportContent: {
    padding: 16,
    gap: 12,
  },
  reportHeader: {
    gap: 5,
  },
  reportTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontFamily: theme.fonts.extraBold,
  },
  reportSubtitle: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  reasonChip: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface,
  },
  reasonChipActive: {
    borderColor: theme.colors.dangerText,
    backgroundColor: theme.colors.dangerSurface,
  },
  reasonChipText: {
    color: theme.colors.textSoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  reasonChipTextActive: {
    color: theme.colors.dangerText,
  },
  detailsSection: {
    gap: 6,
  },
  detailsLabel: {
    color: theme.colors.text,
    fontSize: 12,
    fontFamily: theme.fonts.bold,
  },
  detailsInput: {
    minHeight: 124,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: theme.typography.body,
    lineHeight: 21,
  },
  detailsCounter: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    textAlign: 'right',
  },
  reportActions: {
    gap: 8,
  },
  messages: {
    flexGrow: 1,
    padding: 10,
    gap: 4,
  },
  messagesEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagesLoading: {
    flex: 1,
  },
  messageRow: {
    flexDirection: 'row',
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
    marginBottom: 6,
  },
  emptyTitle: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  emptyDescription: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
    textAlign: 'center',
  },
  inputSafeArea: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  messageCounter: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    textAlign: 'right',
    paddingHorizontal: 12,
    paddingBottom: 5,
    marginTop: -6,
  },
  input: {
    flex: 1,
    minHeight: 36,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    paddingHorizontal: 8,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
  },
  sendButton: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.disabledSurface,
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
