import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { useAuth } from '../../context/AuthContext';
import { likeUser, undoLikeUser } from '../../services/api';
import type { Movie } from '../../services/tmdb';
import { SCREEN_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { theme } from '../../shared/theme';
import EmptyState from './EmptyState';
import useDiscoveryData from '../hooks/useDiscoveryData';
import useWindowClass from '../hooks/useWindowClass';
import useSwipeQuota from '../hooks/useSwipeQuota';
import SwipeModal from './SwipeModal';
import SwipeQuotaBar from './SwipeQuotaBar';
import UserMiniCard from './UserMiniCard';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import AppRefreshControl from './ui/AppRefreshControl';
import { UserGridSkeleton } from './ui/Skeleton';

interface CompatibilityScreenProps {
  onMovieClick: (movie: Movie) => void;
  onOpenMessages?: () => void;
}

export default function CompatibilityScreen({
  onMovieClick,
  onOpenMessages,
}: CompatibilityScreenProps) {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const layout = useWindowClass();
  const gridColumns = layout.gridColumns;
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
  } =
    useDiscoveryData(
    'compatibility',
    currentUser?.id,
  );
  const quota = useSwipeQuota(currentUser?.id);
  const [swipeStartIndex, setSwipeStartIndex] = useState<number | null>(null);

  const usersWithData = useMemo(() => {
    if (!currentUser) {
      return [];
    }

    return compatibilityEntries;
  }, [compatibilityEntries, currentUser]);

  if (loading && usersWithData.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <UserGridSkeleton />
      </SafeAreaView>
    );
  }

  if (status === 'error' && error && usersWithData.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <DataState
          state="fatal-error"
          title={t('data.error.title')}
          description={t(error.userMessageKey as never)}
          actionLabel={t('data.action.retry')}
          onAction={() => void refresh(true)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <FlatList
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: SCREEN_BOTTOM_SPACING + 82 }]}
        refreshControl={
          <AppRefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh(true)}
          />
        }
        data={usersWithData}
        key={`compatibility-grid-${gridColumns}`}
        keyExtractor={(item) => item.user.id}
        numColumns={gridColumns}
        columnWrapperStyle={gridColumns > 1 ? styles.gridRow : undefined}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasMore && !loadingMore) {
            void loadMore();
          }
        }}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.pageLoader} accessibilityRole="progressbar">
              <ActivityIndicator color={theme.colors.primarySoft} />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {stale ? (
              <DataWarningBanner
                title={t('data.stale.title')}
                description={t('data.stale.description')}
                actionLabel={t('data.action.retry')}
                onAction={() => void refresh(true)}
              />
            ) : null}
            <Text style={styles.title}>{t('compatibility.title')}</Text>
            <Text style={styles.subtitle}>{t('compatibility.subtitle')}</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="account-search-outline"
            title={t('compatibility.empty.title')}
            description={t('compatibility.empty.description')}
          />
        }
        renderItem={({ item, index }) => (
          <UserMiniCard
            user={item.user}
            score={item.score}
            style={gridColumns === 1 ? styles.fullWidthCard : undefined}
            onPress={() => setSwipeStartIndex(index)}
          />
        )}
      />

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

      {swipeStartIndex != null ? (
        <SwipeModal
          users={usersWithData.map(({ user, score }) => ({ user, score }))}
          instantMatchUserIds={likedByUserIds}
          startIndex={swipeStartIndex}
          onClose={() => {
            setSwipeStartIndex(null);
            void refresh(true);
          }}
          onMovieClick={onMovieClick}
          onOpenMessages={onOpenMessages}
          onRefreshFeed={() => void refresh(true)}
          onMatchUser={(user) => suppressUser(user.id)}
          allowSwipeLeft
          allowSwipeRight
          undoEnabled
          activeQuotaKinds={['like', 'dislike', 'undo']}
          onSwipeRightUser={(user) => likeUser(user.id, 'compatibility')}
          onUndoSwipeRightUser={(user) => undoLikeUser(user.id)}
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
    paddingTop: 14,
    gap: 14,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  loadingText: {
    color: theme.colors.textMuted,
    marginTop: 12,
    fontSize: 12,
    fontWeight: '700',
  },
  header: {
    gap: 5,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.title,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  gridRow: {
    flexDirection: 'row',
    gap: theme.layout.cardGap,
    marginBottom: 10,
  },
  fullWidthCard: {
    width: '100%',
  },
  pageLoader: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
