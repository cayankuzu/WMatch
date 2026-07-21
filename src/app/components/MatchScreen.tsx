import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useLibrary, useWatchSession } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { likeUser, undoLikeUser } from '../../services/api';
import { getMediaRefKey, movieToMediaRef, type Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import { calculateCompatibilityScore } from '../../shared/utils/compatibility';
import useDiscoveryData from '../hooks/useDiscoveryData';
import EmptyState from './EmptyState';
import SwipeModal from './SwipeModal';
import AppRefreshControl from './ui/AppRefreshControl';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import { SwipeDeckSkeleton } from './ui/Skeleton';

interface MatchScreenProps {
  onMovieClick: (movie: Movie) => void;
  onOpenMessages?: () => void;
  onBack?: () => void;
}

export default function MatchScreen({ onMovieClick, onOpenMessages, onBack }: MatchScreenProps) {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const { activeWatching } = useWatchSession();
  const { favorites, watched } = useLibrary();
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

  const favoriteMedia = useMemo(() => favorites.map(movieToMediaRef), [favorites]);
  const watchedMedia = useMemo(() => watched.map(movieToMediaRef), [watched]);
  const activeWatchingId = activeWatching?.id ?? null;
  const activeWatchingMediaType = activeWatching?.media_type ?? null;
  const activeWatchingKey = activeWatchingId
    ? getMediaRefKey({ id: activeWatchingId, mediaType: activeWatchingMediaType ?? 'movie' })
    : null;
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
    if (activeWatchingKey) {
      void refresh(true);
    }
  }, [activeWatchingKey, refresh]);

  const warning = stale ? (
    <DataWarningBanner
      title={t('data.stale.title')}
      description={t('data.stale.description')}
      actionLabel={t('data.action.retry')}
      onAction={() => void refresh(true)}
    />
  ) : null;

  let emptyContent;
  if (loading && usersWithScore.length === 0) {
    emptyContent = <SwipeDeckSkeleton />;
  } else if (activeWatchingId && status === 'error' && error) {
    emptyContent = (
      <ScrollView
        contentContainerStyle={styles.center}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}
      >
        <DataState
          state="fatal-error"
          title={t('data.error.title')}
          description={t(error.userMessageKey as never)}
          actionLabel={t('data.action.retry')}
          onAction={() => void refresh(true)}
        />
      </ScrollView>
    );
  } else {
    emptyContent = (
      <ScrollView
        contentContainerStyle={styles.center}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => void refresh(true)} />}
      >
        {warning}
        <EmptyState
          icon={activeWatchingId ? 'cards-heart' : 'movie-open-check-outline'}
          title={activeWatchingId
            ? t('match.screen.empty.noPeers.title')
            : t('match.screen.empty.watchMissing.title')}
          description={activeWatchingId
            ? t('match.screen.empty.noPeers.description')
            : t('match.screen.empty.watchMissing.description')}
        />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <SwipeModal
        key={activeWatchingKey ?? 'no-active-watch'}
        users={usersWithScore}
        instantMatchUserIds={likedByUserIds}
        startIndex={0}
        presentation="inline"
        onClose={onBack ?? (() => undefined)}
        onBack={onBack}
        onMovieClick={onMovieClick}
        onOpenMessages={onOpenMessages}
        onRefreshFeed={() => refresh(true)}
        onLoadMoreFeed={activeWatchingId ? loadMore : undefined}
        hasMore={Boolean(activeWatchingId && hasMore)}
        loadingMore={loadingMore}
        onSwipeRightUser={(user) => likeUser(user.id, 'watch')}
        onUndoSwipeRightUser={(user) => undoLikeUser(user.id)}
        onMatchUser={(user) => suppressUser(user.id)}
        onUserRemoved={(user) => suppressUser(user.id)}
        allowSwipeLeft
        allowSwipeRight
        undoEnabled
        activeQuotaKinds={['like', 'dislike', 'undo']}
        emptyContent={emptyContent}
        banner={usersWithScore.length > 0 ? warning : null}
        reportSource="match_screen"
        modeTitle={t('match.screen.modeTitle')}
        modeSubtitle={activeWatching
          ? t('match.screen.modeSubtitle', {
              title: activeWatching.title || activeWatching.name || t('movie.detail.untitled'),
            })
          : t('match.screen.modeSubtitleMissing')}
      />
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
    paddingHorizontal: 12,
  },
});
