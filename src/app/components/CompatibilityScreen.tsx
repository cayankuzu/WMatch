import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { useAuth } from '../../context/AuthContext';
import { likeUser, undoLikeUser } from '../../services/api';
import type { Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import EmptyState from './EmptyState';
import useDiscoveryData from '../hooks/useDiscoveryData';
import useSwipeQuota from '../hooks/useSwipeQuota';
import SwipeModal from './SwipeModal';
import SwipeQuotaBar from './SwipeQuotaBar';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import AppRefreshControl from './ui/AppRefreshControl';
import { SwipeDeckSkeleton } from './ui/Skeleton';

const noop = () => undefined;

interface CompatibilityScreenProps {
  onMovieClick: (movie: Movie) => void;
  onOpenMessages?: () => void;
  onBack?: () => void;
}

export default function CompatibilityScreen({
  onMovieClick,
  onOpenMessages,
  onBack,
}: CompatibilityScreenProps) {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const {
    compatibilityEntries,
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
  } = useDiscoveryData('compatibility', currentUser?.id);
  const quota = useSwipeQuota(currentUser?.id);

  const usersWithData = useMemo(() => {
    if (!currentUser) {
      return [];
    }

    return compatibilityEntries;
  }, [compatibilityEntries, currentUser]);
  const swipeUsers = useMemo(
    () => usersWithData.map(({ user, score }) => ({ user, score })),
    [usersWithData],
  );

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

  const staleBanner = stale ? (
    <DataWarningBanner
      title={t('data.stale.title')}
      description={t('data.stale.description')}
      actionLabel={t('data.action.retry')}
      onAction={() => void refresh(true)}
    />
  ) : null;

  if (loading && usersWithData.length === 0) {
    return (
      <View style={styles.container}>
        <SwipeDeckSkeleton />
        {quotaBar}
      </View>
    );
  }

  if (status === 'error' && error && usersWithData.length === 0) {
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
      </View>
    );
  }

  if (usersWithData.length === 0) {
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
            icon="account-search-outline"
            title={t('compatibility.empty.title')}
            description={t('compatibility.empty.description')}
          />
        </ScrollView>
        {quotaBar}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SwipeModal
        presentation="inline"
        users={swipeUsers}
        instantMatchUserIds={likedByUserIds}
        startIndex={0}
        onClose={noop}
        onBack={onBack}
        onMovieClick={onMovieClick}
        onOpenMessages={onOpenMessages}
        onRefreshFeed={() => refresh(true)}
        onLoadMoreFeed={() => loadMore()}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onMatchUser={(user) => suppressUser(user.id)}
        allowSwipeLeft
        allowSwipeRight
        undoEnabled
        activeQuotaKinds={['like', 'dislike', 'undo']}
        onSwipeRightUser={(user) => likeUser(user.id, 'compatibility')}
        onUndoSwipeRightUser={(user) => undoLikeUser(user.id)}
        modeTitle={t('compatibility.modeTitle')}
        modeSubtitle={t('compatibility.modeSubtitle')}
      />

      {staleBanner ? <View style={styles.bannerOverlay}>{staleBanner}</View> : null}
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
  bannerOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    zIndex: 5,
  },
});
