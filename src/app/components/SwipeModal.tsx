import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { type ApiUser } from '../../services/api';
import type { Movie } from '../../services/tmdb';
import type { SwipeQuotaKind, SwipeQuotaState } from '../../shared/types';
import { theme } from '../../shared/theme';
import useSwipeQuota from '../hooks/useSwipeQuota';
import MatchSuccessModal from './MatchSuccessModal';
import ProfileViewer from './ProfileViewer';
import SwipeActionMenuOverlay from './SwipeActionMenuOverlay';
import SwipeQuotaBar from './SwipeQuotaBar';
import SwipeUndoPlaceholder from './SwipeUndoPlaceholder';
import useTransientPopup from '../hooks/useTransientPopup';
import TransientPopup from './ui/TransientPopup';
import AccessibleModal from './ui/AccessibleModal';

interface SwipeActionResult {
  matched?: boolean;
  success?: boolean;
  errorMessage?: string;
  rewardLikes?: number;
  quota?: SwipeQuotaState;
  matchedUser?: ApiUser | null;
  blockedByActiveMatch?: boolean;
}

interface SwipeModalProps {
  users: Array<{ user: ApiUser; score: number }>;
  instantMatchUserIds?: string[];
  startIndex: number;
  onClose: () => void;
  presentation?: 'modal' | 'inline';
  onBack?: () => void;
  onMovieClick?: (movie: Movie) => void;
  onOpenMessages?: () => void;
  onRefreshFeed?: () => Promise<void> | void;
  onLoadMoreFeed?: () => Promise<void> | void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onMatchUser?: (user: ApiUser) => void;
  allowSwipeLeft?: boolean;
  allowSwipeRight?: boolean;
  undoEnabled?: boolean;
  onSwipeLeftUser?: (user: ApiUser) => Promise<SwipeActionResult | boolean | void> | SwipeActionResult | boolean | void;
  onSwipeRightUser?: (user: ApiUser) => Promise<SwipeActionResult | boolean | void> | SwipeActionResult | boolean | void;
  onUndoSwipeLeftUser?: (user: ApiUser) => Promise<SwipeActionResult | boolean | void> | SwipeActionResult | boolean | void;
  onUndoSwipeRightUser?: (user: ApiUser) => Promise<SwipeActionResult | boolean | void> | SwipeActionResult | boolean | void;
  activeQuotaKinds?: SwipeQuotaKind[];
  emptyContent?: ReactNode;
  banner?: ReactNode;
  reportSource?: string;
  onUserRemoved?: (user: ApiUser) => void;
}

interface SwipeHistoryEntry {
  id: string;
  queueIndex: number;
  direction: 'left' | 'right';
  user: ApiUser;
  pending: boolean;
}

function normalizeSwipeResult(result: SwipeActionResult | boolean | void) {
  if (typeof result === 'boolean') {
    return { matched: false, success: result };
  }

  return {
    matched: Boolean(result?.matched),
    errorMessage: result?.errorMessage,
    rewardLikes: result?.rewardLikes,
    quota: result?.quota,
    matchedUser: result?.matchedUser,
    success: result?.success !== false,
  };
}

function normalizeUndoResult(result: SwipeActionResult | boolean | void) {
  if (typeof result === 'boolean') {
    return {
      success: result,
      blockedByActiveMatch: false,
    };
  }

  if (typeof result === 'object' && result != null && 'success' in result) {
    return {
      success: result.success !== false,
      blockedByActiveMatch: Boolean(result.blockedByActiveMatch),
      errorMessage: result.errorMessage,
      quota: result.quota,
    };
  }

  return {
    success: true,
    blockedByActiveMatch: false,
  };
}

export default function SwipeModal({
  users,
  instantMatchUserIds = [],
  startIndex,
  onClose,
  presentation = 'modal',
  onBack,
  onMovieClick,
  onOpenMessages,
  onRefreshFeed,
  onLoadMoreFeed,
  hasMore = false,
  loadingMore = false,
  onMatchUser,
  allowSwipeLeft = true,
  allowSwipeRight = true,
  undoEnabled = false,
  onSwipeLeftUser,
  onSwipeRightUser,
  onUndoSwipeLeftUser,
  onUndoSwipeRightUser,
  activeQuotaKinds,
  emptyContent,
  banner,
  reportSource = 'swipe_modal',
  onUserRemoved,
}: SwipeModalProps) {
  const { user: currentUser } = useAuth();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const quota = useSwipeQuota(currentUser?.id);
  const feedbackPopup = useTransientPopup(1500);
  const [queue, setQueue] = useState(() => users.slice(startIndex));
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [matchedUser, setMatchedUser] = useState<ApiUser | null>(null);
  const [matchedScore, setMatchedScore] = useState(0);
  const [matchedRewardLikes, setMatchedRewardLikes] = useState<number | undefined>(undefined);
  const [history, setHistory] = useState<SwipeHistoryEntry[]>([]);
  const [queuedUndoActionId, setQueuedUndoActionId] = useState<string | null>(null);
  const [activeInstantMatchActionId, setActiveInstantMatchActionId] = useState<string | null>(null);
  const [dismissedInstantMatchActionIds, setDismissedInstantMatchActionIds] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const interactionLockedRef = useRef(false);
  const activeInstantMatchActionIdRef = useRef<string | null>(null);
  const dismissedInstantMatchActionIdsRef = useRef(new Set<string>());
  const instantMatchUserIdSet = useMemo(() => new Set(instantMatchUserIds), [instantMatchUserIds]);
  const isInline = presentation === 'inline';
  const bottomInset = isInline ? 84 : 84 + insets.bottom;
  const activeBackHandler = isInline ? onBack : onClose;
  const sourceQueue = useMemo(() => users.slice(startIndex), [startIndex, users]);

  const currentData = queue[currentQueueIndex];
  const lastHistoryEntry = history.at(-1) ?? null;
  const hasUndoTarget = Boolean(undoEnabled && history.length > 0 && !interactionLocked);
  const canUndoLastAction = Boolean(undoEnabled && lastHistoryEntry && !lastHistoryEntry.pending);
  const resolvedActiveQuotaKinds = useMemo(() => {
    if (activeQuotaKinds) {
      return activeQuotaKinds;
    }

    const kinds: SwipeQuotaKind[] = [];

    if (allowSwipeRight) {
      kinds.push('like');
    }

    if (allowSwipeLeft) {
      kinds.push('dislike');
    }

    if (undoEnabled) {
      kinds.push('undo');
    }

    return kinds;
  }, [activeQuotaKinds, allowSwipeLeft, allowSwipeRight, undoEnabled]);

  const addPendingHistoryAction = (entry: Omit<SwipeHistoryEntry, 'pending'>) => {
    setHistory((current) => [...current, { ...entry, pending: true }]);
  };

  const resolveHistoryAction = (entry: Omit<SwipeHistoryEntry, 'pending'>) => {
    setHistory((current) => {
      let resolvedExisting = false;
      const nextHistory = current.map((item) => {
        if (item.id !== entry.id) {
          return item;
        }

        resolvedExisting = true;
        return { ...item, pending: false };
      });

      if (resolvedExisting) {
        return nextHistory;
      }

      return [...nextHistory, { ...entry, pending: false }];
    });
  };

  const removeHistoryAction = (actionId: string) => {
    setQueuedUndoActionId((current) => (current === actionId ? null : current));
    setHistory((current) => current.filter((entry) => entry.id !== actionId));
  };

  useEffect(() => {
    activeInstantMatchActionIdRef.current = activeInstantMatchActionId;
  }, [activeInstantMatchActionId]);

  useEffect(() => {
    dismissedInstantMatchActionIdsRef.current = new Set(dismissedInstantMatchActionIds);
  }, [dismissedInstantMatchActionIds]);

  useEffect(() => {
    setShowMenu(false);
    interactionLockedRef.current = false;
    setInteractionLocked(false);
  }, [currentData?.user.id]);

  useEffect(() => {
    if (history.length === 0 && currentQueueIndex === 0) {
      setQueue(sourceQueue);
      setFinished(false);
      return;
    }

    setQueue((current) => {
      const knownUserIds = new Set(current.map((entry) => entry.user.id));
      const additions = sourceQueue.filter((entry) => !knownUserIds.has(entry.user.id));

      if (additions.length === 0) {
        return current;
      }

      setFinished(false);
      return [...current, ...additions];
    });
  }, [currentQueueIndex, history.length, sourceQueue]);

  useEffect(() => {
    if (!hasMore || loadingMore || !onLoadMoreFeed || queue.length - currentQueueIndex > 5) {
      return;
    }

    void onLoadMoreFeed();
  }, [currentQueueIndex, hasMore, loadingMore, onLoadMoreFeed, queue.length]);

  const handleRefreshFeed = async () => {
    if (interactionLockedRef.current) {
      return;
    }

    interactionLockedRef.current = true;
    setInteractionLocked(true);
    setShowMenu(false);
    feedbackPopup.showPopup(t('swipe.feedback.refreshing'));

    try {
      await onRefreshFeed?.();
      feedbackPopup.showPopup(t('swipe.feedback.refreshed'));
    } catch {
      feedbackPopup.showPopup(t('swipe.feedback.refreshFailed'));
    } finally {
      interactionLockedRef.current = false;
      setInteractionLocked(false);
    }
  };

  const prepareMatchPresentation = () => {
    setMatchedRewardLikes(undefined);
  };

  const moveToNextCard = (queueIndex: number) => {
    if (queueIndex >= queue.length - 1) {
      setFinished(true);
      setCurrentQueueIndex(queue.length);
      return;
    }

    setCurrentQueueIndex(queueIndex + 1);
  };

  const restoreCardFromHistory = (entry: SwipeHistoryEntry) => {
    setHistory((current) => current.slice(0, -1));
    setFinished(false);
    setMatchedUser(null);
    setMatchedRewardLikes(undefined);
    setCurrentQueueIndex(entry.queueIndex);
  };

  const removeCurrentUserFromQueue = (userId: string) => {
    const nextQueue = queue.filter((entry) => entry.user.id !== userId);
    setQueue(nextQueue);
    setHistory((current) => current.filter((entry) => entry.user.id !== userId));

    if (currentQueueIndex >= nextQueue.length) {
      setFinished(true);
      setCurrentQueueIndex(nextQueue.length);
      return;
    }

    setFinished(false);
  };

  const advance = (direction: 'left' | 'right') => {
    if (!currentData || interactionLockedRef.current) {
      return;
    }

    if (!quota.ready) {
      Alert.alert(t('swipe.alert.loadingTitle'), t('swipe.alert.loadingDescription'));
      return;
    }

    if (direction === 'right' && quota.remainingLikes <= 0) {
      Alert.alert(t('swipe.alert.actionFailedTitle'), t('swipe.alert.likeLimitDescription'));
      return;
    }

    if (direction === 'left' && quota.remainingDislikes <= 0) {
      Alert.alert(t('swipe.alert.actionFailedTitle'), t('swipe.alert.dislikeLimitDescription'));
      return;
    }

    if (!quota.optimisticConsume(direction === 'right' ? 'like' : 'dislike')) {
      Alert.alert(t('swipe.alert.actionFailedTitle'), t('swipe.alert.unavailableDescription'));
      return;
    }

    interactionLockedRef.current = true;
    setInteractionLocked(true);

    const actionId = `${currentData.user.id}:${direction}:${Date.now()}`;
    const queueIndex = currentQueueIndex;
    const entry = currentData;
    const predictedInstantMatch = direction === 'right' && instantMatchUserIdSet.has(entry.user.id);
    const historyEntry = { id: actionId, queueIndex, direction, user: entry.user };

    if (undoEnabled && (direction === 'left' || !predictedInstantMatch)) {
      addPendingHistoryAction(historyEntry);
    }

    if (predictedInstantMatch) {
      setActiveInstantMatchActionId(actionId);
      setDismissedInstantMatchActionIds((current) => current.filter((id) => id !== actionId));
      prepareMatchPresentation();
      setMatchedUser(entry.user);
      setMatchedScore(entry.score);
      setMatchedRewardLikes(undefined);
    }

    moveToNextCard(queueIndex);

    void (async () => {
      try {
        const actionResult =
          direction === 'left'
            ? await onSwipeLeftUser?.(entry.user)
            : await onSwipeRightUser?.(entry.user);
        const normalizedResult = normalizeSwipeResult(actionResult);

        if (!normalizedResult.success) {
          if (predictedInstantMatch) {
            setActiveInstantMatchActionId(null);
            setMatchedUser(null);
            setMatchedRewardLikes(undefined);
          }

          quota.optimisticRestore(direction === 'right' ? 'like' : 'dislike');

          if (undoEnabled) {
            removeHistoryAction(actionId);
          }

          if (normalizedResult.errorMessage) {
            Alert.alert(t('swipe.alert.actionFailedTitle'), normalizedResult.errorMessage);
          }

          onRefreshFeed?.();
          return;
        }

        if (direction === 'left') {
          const consumed = await quota.consumeSwipe('dislike');

          if (!consumed) {
            quota.optimisticRestore('dislike');

            if (undoEnabled) {
              removeHistoryAction(actionId);
            }

            Alert.alert(t('swipe.alert.dislikeLimitTitle'), t('swipe.alert.dislikeLimitDescription'));
            onRefreshFeed?.();
            return;
          }
        } else {
          if (normalizedResult.quota) {
            quota.applyServerState(normalizedResult.quota);
          }

          if (normalizedResult.matched) {
            removeHistoryAction(actionId);
            prepareMatchPresentation();
            const nextMatchedUser = normalizedResult.matchedUser ?? entry.user;
            const instantMatchWasDismissed =
              predictedInstantMatch && dismissedInstantMatchActionIdsRef.current.has(actionId);

            if (!instantMatchWasDismissed) {
              setMatchedUser(nextMatchedUser);
              setMatchedScore(entry.score);
            }

            setActiveInstantMatchActionId(null);
            setDismissedInstantMatchActionIds((current) => current.filter((id) => id !== actionId));
            setMatchedRewardLikes(normalizedResult.rewardLikes);
            onMatchUser?.(nextMatchedUser);
            setTimeout(() => {
              onRefreshFeed?.();
            }, 250);
            return;
          }

          if (predictedInstantMatch) {
            setActiveInstantMatchActionId(null);
            setDismissedInstantMatchActionIds((current) => current.filter((id) => id !== actionId));
            setMatchedUser(null);
            setMatchedRewardLikes(undefined);
          }

          if (undoEnabled) {
            resolveHistoryAction(historyEntry);
            return;
          }
        }

        if (undoEnabled) {
          resolveHistoryAction(historyEntry);
        }
      } catch {
        if (predictedInstantMatch) {
          setActiveInstantMatchActionId(null);
          setMatchedUser(null);
          setMatchedRewardLikes(undefined);
        }
        quota.optimisticRestore(direction === 'right' ? 'like' : 'dislike');
        removeHistoryAction(actionId);
        Alert.alert(t('swipe.alert.actionFailedTitle'), t('swipe.alert.unavailableDescription'));
        void onRefreshFeed?.();
      }
    })();
  };

  const undoLastAction = async () => {
    if (interactionLockedRef.current) {
      return;
    }

    if (!quota.ready) {
      Alert.alert(t('swipe.alert.loadingTitle'), t('swipe.alert.loadingDescription'));
      return;
    }

    const lastAction = history.at(-1);

    if (!lastAction) {
      return;
    }

    if (lastAction.pending) {
      setQueuedUndoActionId(lastAction.id);
      return;
    }

    if (!undoEnabled) {
      return;
    }

    if (quota.remainingUndos <= 0) {
      Alert.alert(t('swipe.alert.undoLimitTitle'), t('swipe.alert.undoLimitDescription'));
      return;
    }

    if (!quota.optimisticConsume('undo')) {
      Alert.alert(t('swipe.alert.undoLimitTitle'), t('swipe.alert.undoLimitDescription'));
      return;
    }

    interactionLockedRef.current = true;
    setInteractionLocked(true);

    try {
      const undoResult =
        lastAction.direction === 'left'
          ? await onUndoSwipeLeftUser?.(lastAction.user)
          : await onUndoSwipeRightUser?.(lastAction.user);

      const normalizedUndoResult = normalizeUndoResult(undoResult);

      if (!normalizedUndoResult.success) {
        quota.optimisticRestore('undo');

        if (normalizedUndoResult.blockedByActiveMatch) {
          setHistory((current) => current.slice(0, -1));
          onRefreshFeed?.();
          return;
        }

        if (normalizedUndoResult.errorMessage) {
          Alert.alert(t('swipe.alert.actionFailedTitle'), normalizedUndoResult.errorMessage);
        }

        return;
      }

      restoreCardFromHistory(lastAction);

      if (lastAction.direction === 'right' && normalizedUndoResult.quota) {
        quota.applyServerState(normalizedUndoResult.quota);
      }

      const consumed = lastAction.direction === 'right' ? true : await quota.consumeUndo();

      if (!consumed) {
        quota.optimisticRestore('undo');
        void quota.refresh();
        onRefreshFeed?.();
      }
    } catch {
      quota.optimisticRestore('undo');
      void quota.refresh();
      Alert.alert(t('swipe.alert.actionFailedTitle'), t('swipe.alert.unavailableDescription'));
    } finally {
      interactionLockedRef.current = false;
      setInteractionLocked(false);
    }
  };

  useEffect(() => {
    if (!queuedUndoActionId) {
      return;
    }

    const lastAction = history.at(-1);

    if (!lastAction) {
      setQueuedUndoActionId(null);
      return;
    }

    if (lastAction.id === queuedUndoActionId && !lastAction.pending) {
      setQueuedUndoActionId(null);
      void undoLastAction();
    }
  }, [history, queuedUndoActionId]);

  const content = (
    <>
        {currentData ? (
          <ProfileViewer
            user={currentData.user}
            onMovieClick={onMovieClick}
            swipeEnabled
            allowSwipeLeft={!interactionLocked && allowSwipeLeft}
            allowSwipeRight={!interactionLocked && allowSwipeRight}
            onSwipeLeft={() => void advance('left')}
            onSwipeRight={() => void advance('right')}
            onSwipeDown={!interactionLocked && hasUndoTarget ? () => void undoLastAction() : undefined}
            onBack={activeBackHandler}
            onHeaderRightPress={interactionLocked ? undefined : () => void handleRefreshFeed()}
            headerRightIcon={interactionLocked ? undefined : 'reload'}
            onSecondaryHeaderRightPress={interactionLocked ? undefined : () => setShowMenu((value) => !value)}
            secondaryHeaderRightIcon={interactionLocked ? undefined : 'dots-vertical'}
            bottomInset={bottomInset}
          />
        ) : finished || history.length > 0 ? (
          <SwipeUndoPlaceholder
            onUndo={hasUndoTarget ? () => void undoLastAction() : undefined}
            onReload={() => void handleRefreshFeed()}
            onBack={activeBackHandler}
            bottomInset={bottomInset}
            undoPending={hasUndoTarget && !canUndoLastAction}
          />
        ) : emptyContent}

        {banner ? <View pointerEvents="box-none" style={styles.bannerOverlay}>{banner}</View> : null}

        <SwipeQuotaBar
          remainingLikes={quota.remainingLikes}
          remainingDislikes={quota.remainingDislikes}
          remainingUndos={quota.remainingUndos}
          remainingMs={quota.remainingMs}
          loading={!quota.ready}
          activeKinds={resolvedActiveQuotaKinds}
          bottomOffset={0}
          respectSafeArea={!isInline}
        />

        <SwipeActionMenuOverlay
          visible={showMenu}
          user={currentData?.user ?? null}
          reportSource={reportSource}
          onClose={() => setShowMenu(false)}
          showFeedback={feedbackPopup.showPopup}
          onBlockSuccess={async (user) => {
            onUserRemoved?.(user);
            removeCurrentUserFromQueue(user.id);
            await onRefreshFeed?.();
          }}
        />

        <TransientPopup message={feedbackPopup.message} bottomOffset={18} icon="information-outline" />

        <MatchSuccessModal
          visible={matchedUser != null}
          user={matchedUser}
          currentUser={currentUser ?? null}
          score={matchedScore}
          rewardLikes={matchedRewardLikes}
          onClose={() => {
            if (activeInstantMatchActionIdRef.current) {
              setDismissedInstantMatchActionIds((current) => (
                current.includes(activeInstantMatchActionIdRef.current!)
                  ? current
                  : [...current, activeInstantMatchActionIdRef.current!]
              ));
            }

            setMatchedUser(null);
            setMatchedRewardLikes(undefined);
          }}
          onOpenMessages={() => {
            if (!isInline) {
              onClose();
            }
            onOpenMessages?.();
          }}
        />
    </>
  );

  if (isInline) {
    return <View style={styles.container}>{content}</View>;
  }

  return (
    <AccessibleModal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView accessibilityViewIsModal importantForAccessibility="yes" edges={['top']} style={styles.container}>
        {content}
      </SafeAreaView>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  bannerOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 5,
  },
});
