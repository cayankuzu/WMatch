import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { likeUser, undoLikeUser, type ApiUser } from '../../services/api';
import { movieToMediaRef, type Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import { calculateCompatibilityScore } from '../../shared/utils/compatibility';
import EmptyState from './EmptyState';
import useDiscoveryData from '../hooks/useDiscoveryData';
import useSwipeQuota from '../hooks/useSwipeQuota';
import MatchSuccessModal from './MatchSuccessModal';
import ProfileViewer from './ProfileViewer';
import SwipeActionMenuOverlay from './SwipeActionMenuOverlay';
import SwipeQuotaBar from './SwipeQuotaBar';
import SwipeUndoPlaceholder from './SwipeUndoPlaceholder';
import useTransientPopup from '../hooks/useTransientPopup';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import { SwipeDeckSkeleton } from './ui/Skeleton';
import TransientPopup from './ui/TransientPopup';
import AppRefreshControl from './ui/AppRefreshControl';

interface MatchScreenProps {
  onMovieClick: (movie: Movie) => void;
  onOpenMessages?: () => void;
  onBack?: () => void;
}

interface FeedEntry {
  user: ApiUser;
  score: number;
}

interface SwipeHistoryEntry {
  id: string;
  queueIndex: number;
  direction: 'left' | 'right';
  user: ApiUser;
  pending: boolean;
}

export default function MatchScreen({ onMovieClick, onOpenMessages, onBack }: MatchScreenProps) {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const { activeWatching, favorites, watched } = useApp();
  const {
    watchUsers,
    likedByUserIds,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    status,
    error,
    stale,
    refresh,
    loadMore,
    suppressUser,
  } = useDiscoveryData('watch', currentUser?.id);
  const quota = useSwipeQuota(currentUser?.id);
  const [feedQueue, setFeedQueue] = useState<FeedEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ended, setEnded] = useState(false);
  const [matchedUser, setMatchedUser] = useState<ApiUser | null>(null);
  const [matchedScore, setMatchedScore] = useState(0);
  const [matchedRewardLikes, setMatchedRewardLikes] = useState<number | undefined>(undefined);
  const [history, setHistory] = useState<SwipeHistoryEntry[]>([]);
  const [queuedUndoActionId, setQueuedUndoActionId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(false);
  const interactionLockOwnerRef = useRef<string | null>(null);
  const activeInstantMatchActionIdRef = useRef<string | null>(null);
  const dismissedInstantMatchActionIdsRef = useRef(new Set<string>());
  const feedbackPopup = useTransientPopup(1500);

  const favoriteMedia = useMemo(() => favorites.map(movieToMediaRef), [favorites]);
  const watchedMedia = useMemo(() => watched.map(movieToMediaRef), [watched]);
  const activeWatchingId = activeWatching?.id ?? null;
  const activeWatchingMediaType = activeWatching?.media_type ?? null;
  const instantMatchUserIds = useMemo(() => new Set(likedByUserIds), [likedByUserIds]);

  const usersWithScore = useMemo(() => {
    if (!activeWatchingId) {
      return [];
    }

    return watchUsers
      .filter(
        (user) =>
          user.currentlyWatching === activeWatchingId &&
          (user.currentlyWatchingMediaType ?? 'movie') === (activeWatchingMediaType ?? 'movie'),
      )
      .map((user) => ({
        user,
        score: calculateCompatibilityScore(
          favoriteMedia,
          watchedMedia,
          user.favoriteMedia?.length ? user.favoriteMedia : user.favoriteMovies,
          user.watchedMedia?.length ? user.watchedMedia : user.watchedMovies,
        ),
      }))
      .sort((left, right) => right.score - left.score);
  }, [activeWatchingId, activeWatchingMediaType, favoriteMedia, watchUsers, watchedMedia]);

  useEffect(() => {
    setFeedQueue(usersWithScore);
    setCurrentIndex(0);
    setEnded(false);
    setHistory([]);
    setQueuedUndoActionId(null);
  }, [activeWatchingId, activeWatchingMediaType]);

  useEffect(() => {
    if (!activeWatchingId) {
      setFeedQueue([]);
      setCurrentIndex(0);
      setEnded(false);
      setHistory([]);
      setQueuedUndoActionId(null);
      return;
    }

    if (history.length === 0 && currentIndex === 0 && !ended) {
      setFeedQueue(usersWithScore);
    }
  }, [activeWatchingId, currentIndex, ended, history.length, usersWithScore]);

  useEffect(() => {
    if (!activeWatchingId || currentIndex === 0) {
      return;
    }

    setFeedQueue((current) => {
      const knownUserIds = new Set(current.map((entry) => entry.user.id));
      const additions = usersWithScore.filter((entry) => !knownUserIds.has(entry.user.id));
      return additions.length > 0 ? [...current, ...additions] : current;
    });
  }, [activeWatchingId, currentIndex, usersWithScore]);

  useEffect(() => {
    if (
      activeWatchingId &&
      hasMore &&
      !loadingMore &&
      feedQueue.length - currentIndex <= 5
    ) {
      void loadMore();
    }
  }, [activeWatchingId, currentIndex, feedQueue.length, hasMore, loadMore, loadingMore]);

  const currentData = feedQueue[currentIndex];
  const lastHistoryEntry = history.at(-1) ?? null;
  const hasUndoTarget = history.length > 0 && !interactionLocked;
  const canUndoLastAction = Boolean(lastHistoryEntry && !lastHistoryEntry.pending);

  useEffect(() => {
    setShowMenu(false);
    interactionLockOwnerRef.current = null;
    setInteractionLocked(false);
  }, [currentData?.user.id]);

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

  const prepareMatchPresentation = () => {
    setMatchedRewardLikes(undefined);
  };

  const moveToNextCard = (queueIndex: number) => {
    if (queueIndex >= feedQueue.length - 1) {
      setEnded(true);
      setCurrentIndex(feedQueue.length);
      return;
    }

    setCurrentIndex(queueIndex + 1);
  };

  const restoreCardFromHistory = (entry: SwipeHistoryEntry) => {
    setHistory((current) => current.slice(0, -1));
    setEnded(false);
    setMatchedUser(null);
    setMatchedRewardLikes(undefined);
    setCurrentIndex(entry.queueIndex);
  };

  const removeCurrentCard = (userId: string) => {
    const nextQueue = feedQueue.filter((entry) => entry.user.id !== userId);
    setFeedQueue(nextQueue);
    setHistory((current) => current.filter((entry) => entry.user.id !== userId));

    if (currentIndex >= nextQueue.length) {
      setEnded(true);
      setCurrentIndex(nextQueue.length);
      return;
    }

    setEnded(false);
  };

  const handleRefreshFeed = async () => {
    setShowMenu(false);
    feedbackPopup.showPopup(t('swipe.feedback.refreshing'));

    try {
      await refresh(true);
      feedbackPopup.showPopup(t('swipe.feedback.refreshed'));
    } catch {
      feedbackPopup.showPopup(t('swipe.feedback.refreshFailed'));
    }
  };

  const advance = async (direction: 'left' | 'right') => {
    if (!currentData || interactionLockOwnerRef.current) {
      return;
    }

    if (!quota.ready) {
      Alert.alert(t('swipe.alert.loadingTitle'), t('swipe.alert.loadingDescription'));
      return;
    }

    const actionId = `${currentData.user.id}:${direction}:${Date.now()}`;
    const queueIndex = currentIndex;
    const entry = currentData;
    const predictedInstantMatch = direction === 'right' && instantMatchUserIds.has(entry.user.id);
    const historyEntry = { id: actionId, queueIndex, direction, user: entry.user };

    if (direction === 'right') {
      if (quota.remainingLikes <= 0) {
        Alert.alert(t('swipe.alert.likeLimitTitle'), t('swipe.alert.likeLimitDescription'));
        return;
      }
    } else if (quota.remainingDislikes <= 0) {
      Alert.alert(t('swipe.alert.dislikeLimitTitle'), t('swipe.alert.dislikeLimitDescription'));
      return;
    }

    if (!quota.optimisticConsume(direction === 'right' ? 'like' : 'dislike')) {
      Alert.alert(
        direction === 'right' ? t('swipe.alert.likeLimitTitle') : t('swipe.alert.dislikeLimitTitle'),
        direction === 'right' ? t('swipe.alert.likeLimitDescription') : t('swipe.alert.dislikeLimitDescription'),
      );
      return;
    }

    interactionLockOwnerRef.current = actionId;
    setInteractionLocked(true);

    if (direction === 'left' || !predictedInstantMatch) {
      addPendingHistoryAction(historyEntry);
    }

    if (predictedInstantMatch) {
      activeInstantMatchActionIdRef.current = actionId;
      dismissedInstantMatchActionIdsRef.current.delete(actionId);
      prepareMatchPresentation();
      setMatchedUser(entry.user);
      setMatchedScore(entry.score);
      setMatchedRewardLikes(undefined);
    }

    moveToNextCard(queueIndex);

    try {
      if (direction === 'right') {
        const result = await likeUser(entry.user.id, 'watch');

        if (!result.success) {
          if (predictedInstantMatch) {
            activeInstantMatchActionIdRef.current = null;
            setMatchedUser(null);
            setMatchedRewardLikes(undefined);
          }
          quota.optimisticRestore('like');
          removeHistoryAction(actionId);
          void refresh(true);

          if (result.errorMessage) {
            Alert.alert(t('swipe.alert.likeFailedTitle'), result.errorMessage);
          }

          return;
        }

        if (result.quota) {
          quota.applyServerState(result.quota);
        }

        if (result.matched) {
          const nextMatchedUser = result.matchedUser ?? entry.user;
          const instantMatchWasDismissed =
            predictedInstantMatch && dismissedInstantMatchActionIdsRef.current.has(actionId);

          removeHistoryAction(actionId);
          prepareMatchPresentation();
          if (!instantMatchWasDismissed) {
            setMatchedUser(nextMatchedUser);
            setMatchedScore(entry.score);
          }

          activeInstantMatchActionIdRef.current = null;
          dismissedInstantMatchActionIdsRef.current.delete(actionId);
          setMatchedRewardLikes(result.rewardLikes);
          suppressUser(nextMatchedUser.id);
          setTimeout(() => {
            void refresh();
          }, 250);
          return;
        }

        if (predictedInstantMatch) {
          activeInstantMatchActionIdRef.current = null;
          dismissedInstantMatchActionIdsRef.current.delete(actionId);
          setMatchedUser(null);
          setMatchedRewardLikes(undefined);
        }

        resolveHistoryAction(historyEntry);

        return;
      }

      const consumed = await quota.consumeSwipe('dislike');

      if (!consumed) {
        quota.optimisticRestore('dislike');
        removeHistoryAction(actionId);
        void refresh(true);
        Alert.alert(t('swipe.alert.dislikeLimitTitle'), t('swipe.alert.dislikeLimitDescription'));
        return;
      }

      resolveHistoryAction(historyEntry);
    } finally {
      if (interactionLockOwnerRef.current === actionId) {
        interactionLockOwnerRef.current = null;
        setInteractionLocked(false);
      }
    }
  };

  const undoLastAction = async () => {
    if (!quota.ready || interactionLockOwnerRef.current) {
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

    if (quota.remainingUndos <= 0) {
      Alert.alert(t('swipe.alert.undoLimitTitle'), t('swipe.alert.undoLimitDescription'));
      return;
    }

    if (!quota.optimisticConsume('undo')) {
      Alert.alert(t('swipe.alert.undoLimitTitle'), t('swipe.alert.undoLimitDescription'));
      return;
    }

    const undoLockOwner = `undo:${lastAction.id}`;
    interactionLockOwnerRef.current = undoLockOwner;
    setInteractionLocked(true);

    try {
      if (lastAction.direction === 'right') {
        const result = await undoLikeUser(lastAction.user.id);

        if (!result.success) {
          quota.optimisticRestore('undo');

          if (result.blockedByActiveMatch) {
            setHistory((current) => current.slice(0, -1));
            void refresh(true);
            return;
          }

          if (result.errorMessage) {
            Alert.alert(t('swipe.alert.actionFailedTitle'), result.errorMessage);
          }

          return;
        }

        if (result.quota) {
          quota.applyServerState(result.quota);
        }
      }

      restoreCardFromHistory(lastAction);

      const consumed = lastAction.direction === 'right' ? true : await quota.consumeUndo();

      if (!consumed) {
        quota.optimisticRestore('undo');
        void quota.refresh();
        void refresh(true);
      }
    } finally {
      if (interactionLockOwnerRef.current === undoLockOwner) {
        interactionLockOwnerRef.current = null;
        setInteractionLocked(false);
      }
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

  const quotaBar = (
    <SwipeQuotaBar
      remainingLikes={quota.remainingLikes}
      remainingDislikes={quota.remainingDislikes}
      remainingUndos={quota.remainingUndos}
      remainingMs={quota.remainingMs}
      loading={!quota.ready}
      activeKinds={['like', 'dislike', 'undo']}
      bottomOffset={0}
      respectSafeArea={false}
    />
  );
  const matchModal = (
    <MatchSuccessModal
      visible={matchedUser != null}
      user={matchedUser}
      currentUser={currentUser ?? null}
      score={matchedScore}
      rewardLikes={matchedRewardLikes}
      onClose={() => {
        if (activeInstantMatchActionIdRef.current) {
          dismissedInstantMatchActionIdsRef.current.add(activeInstantMatchActionIdRef.current);
        }

        setMatchedUser(null);
        setMatchedRewardLikes(undefined);
      }}
      onOpenMessages={onOpenMessages}
    />
  );
  const staleBanner = stale ? (
    <DataWarningBanner
      title={t('data.stale.title')}
      description={t('data.stale.description')}
      actionLabel={t('data.action.retry')}
      onAction={() => void refresh(true)}
    />
  ) : null;

  if (loading && feedQueue.length === 0) {
    return (
      <View style={styles.container}>
        <SwipeDeckSkeleton />
        {quotaBar}
        {matchModal}
      </View>
    );
  }

  if (activeWatchingId && status === 'error' && error && feedQueue.length === 0) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <AppRefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh(true)}
            />
          }
        >
          <DataState
            state="fatal-error"
            title={t('data.error.title')}
            description={t(error.userMessageKey as never)}
            actionLabel={t('data.action.retry')}
            onAction={() => void refresh(true)}
          />
        </ScrollView>
        {quotaBar}
        {matchModal}
      </View>
    );
  }

  if (!activeWatchingId) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <AppRefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh(true)}
            />
          }
        >
          {staleBanner}
          <EmptyState
            icon="movie-open-check-outline"
            title={t('match.screen.empty.watchMissing.title')}
            description={t('match.screen.empty.watchMissing.description')}
          />
        </ScrollView>
        {quotaBar}
        {matchModal}
      </View>
    );
  }

  if (ended || !currentData) {
    if (feedQueue.length > 0 || history.length > 0) {
      return (
        <View style={styles.container}>
          <SwipeUndoPlaceholder
            onUndo={hasUndoTarget ? () => void undoLastAction() : undefined}
            onReload={() => void handleRefreshFeed()}
            onBack={onBack}
            bottomInset={84}
            undoPending={hasUndoTarget && !canUndoLastAction}
          />

          {quotaBar}
          {matchModal}
        </View>
      );
    }

    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <AppRefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh(true)}
            />
          }
        >
          {staleBanner}
          <EmptyState
            icon="cards-heart"
            title={t('match.screen.empty.noPeers.title')}
            description={t('match.screen.empty.noPeers.description')}
          />
        </ScrollView>
        {quotaBar}
        {matchModal}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ProfileViewer
        user={currentData.user}
        onMovieClick={onMovieClick}
        swipeEnabled
        allowSwipeLeft={!interactionLocked}
        allowSwipeRight={!interactionLocked}
        onSwipeLeft={() => void advance('left')}
        onSwipeRight={() => void advance('right')}
        onSwipeDown={!interactionLocked && hasUndoTarget ? () => void undoLastAction() : undefined}
        onBack={onBack}
        onHeaderRightPress={interactionLocked ? undefined : () => void handleRefreshFeed()}
        headerRightIcon={interactionLocked ? undefined : 'reload'}
        onSecondaryHeaderRightPress={interactionLocked ? undefined : () => setShowMenu((current) => !current)}
        secondaryHeaderRightIcon={interactionLocked ? undefined : 'dots-vertical'}
        bottomInset={84}
      />

      {staleBanner ? <View style={styles.bannerOverlay}>{staleBanner}</View> : null}

      <SwipeActionMenuOverlay
        visible={showMenu}
        user={currentData.user}
        reportSource="match_screen"
        onClose={() => setShowMenu(false)}
        showFeedback={feedbackPopup.showPopup}
        onBlockSuccess={async (user) => {
          suppressUser(user.id);
          removeCurrentCard(user.id);

          try {
            await refresh();
          } catch {
            // Keep the current queue moving even if the background refresh fails.
          }
        }}
      />

      {quotaBar}

      <TransientPopup message={feedbackPopup.message} bottomOffset={18} icon="information-outline" />

      {matchModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  center: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
  },
  bannerOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 5,
  },
});
