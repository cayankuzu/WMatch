import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLibrary } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { likeUser, rejectIncomingLike, unlikeUser, type ApiUser } from '../../services/api';
import {
  SCREEN_BOTTOM_SPACING,
  SCREEN_SIDE_SPACING,
} from '../../shared/constants';
import { movieToMediaRef, type Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import { calculateCompatibilityScore } from '../../shared/utils/compatibility';
import EmptyState from './EmptyState';
import useDiscoveryData from '../hooks/useDiscoveryData';
import useTransientPopup from '../hooks/useTransientPopup';
import useWindowClass from '../hooks/useWindowClass';
import useSwipeQuota from '../hooks/useSwipeQuota';
import SwipeModal from './SwipeModal';
import SwipeQuotaBar from './SwipeQuotaBar';
import UserMiniCard from './UserMiniCard';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import SegmentedControl from './ui/SegmentedControl';
import { UserGridSkeleton } from './ui/Skeleton';
import TransientPopup from './ui/TransientPopup';
import AppRefreshControl from './ui/AppRefreshControl';

interface LikesScreenProps {
  onMovieClick?: (movie: Movie) => void;
  onOpenMessages?: () => void;
  preferredTab?: 'liked' | 'likedme' | null;
}

interface ScoredUser {
  user: ApiUser;
  score: number;
}

export default function LikesScreen({
  onMovieClick,
  onOpenMessages,
  preferredTab = null,
}: LikesScreenProps) {
  const { t } = useLocalization();
  const { width: windowWidth } = useWindowDimensions();
  const layout = useWindowClass();
  const gridColumns = layout.gridColumns;
  const { user: currentUser } = useAuth();
  const { favorites, watched } = useLibrary();
  const {
    likedUsers,
    likedByUsers,
    likedByUserIds,
    likedByCount,
    likedByLocked,
    loading,
    refreshing,
    status,
    error,
    stale,
    refresh,
    suppressUser,
  } =
    useDiscoveryData(
    'likes',
    currentUser?.id,
  );
  const quota = useSwipeQuota(currentUser?.id);
  const [activeTab, setActiveTab] = useState<'liked' | 'likedme'>('liked');
  const [swipeStartIndex, setSwipeStartIndex] = useState<number | null>(null);
  const pagerRef = useRef<FlatList<{ key: 'liked' | 'likedme'; users: ScoredUser[] }> | null>(null);
  const premiumPopup = useTransientPopup();
  const { showPopup } = premiumPopup;
  const favoriteMedia = useMemo(() => favorites.map(movieToMediaRef), [favorites]);
  const watchedMedia = useMemo(() => watched.map(movieToMediaRef), [watched]);

  const likedMeUsers = likedByUsers;
  const activeQuotaKinds = activeTab === 'liked' ? ['dislike'] as const : ['like', 'dislike'] as const;
  const isLikedMeLocked = activeTab === 'likedme' && likedByLocked;

  const getUsersWithScore = useMemo(
    () => (users: typeof likedUsers) =>
      users.map((user) => ({
        user,
        score: calculateCompatibilityScore(
          favoriteMedia,
          watchedMedia,
          user.favoriteMedia?.length ? user.favoriteMedia : user.favoriteMovies,
          user.watchedMedia?.length ? user.watchedMedia : user.watchedMovies,
        ),
      })).sort((left, right) => right.score - left.score),
    [favoriteMedia, watchedMedia],
  );

  const likedUsersWithScore = useMemo(() => {
    if (!currentUser) {
      return [];
    }

    return getUsersWithScore(likedUsers);
  }, [currentUser, getUsersWithScore, likedUsers]);

  const likedMeUsersWithScore = useMemo(() => {
    if (!currentUser) {
      return [];
    }

    return getUsersWithScore(likedMeUsers);
  }, [currentUser, getUsersWithScore, likedMeUsers]);

  const pagerData = useMemo(
    () => [
      { key: 'liked' as const, users: likedUsersWithScore },
      { key: 'likedme' as const, users: likedMeUsersWithScore },
    ],
    [likedMeUsersWithScore, likedUsersWithScore],
  );
  const usersWithScore = activeTab === 'liked' ? likedUsersWithScore : likedMeUsersWithScore;

  useEffect(() => {
    if (!preferredTab || preferredTab === activeTab) {
      return;
    }

    setActiveTab(preferredTab);
    pagerRef.current?.scrollToIndex({
      index: preferredTab === 'liked' ? 0 : 1,
      animated: false,
    });
  }, [activeTab, preferredTab]);

  if (loading && usersWithScore.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <UserGridSkeleton />
      </SafeAreaView>
    );
  }

  if (status === 'error' && error && usersWithScore.length === 0) {
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

  const handleTabChange = (nextTab: 'liked' | 'likedme') => {
    if (nextTab === activeTab) {
      return;
    }

    setActiveTab(nextTab);
    pagerRef.current?.scrollToIndex({
      index: nextTab === 'liked' ? 0 : 1,
      animated: true,
    });
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        {stale ? (
          <DataWarningBanner
            title={t('data.stale.title')}
            description={t('data.stale.description')}
            actionLabel={t('data.action.retry')}
            onAction={() => void refresh(true)}
          />
        ) : null}
        <Text style={styles.title}>{t('likes.title')}</Text>
        <Text style={styles.subtitle}>{t('likes.subtitle')}</Text>
        <SegmentedControl
          value={activeTab}
          onChange={handleTabChange}
          options={[
            { label: t('likes.tab.liked', { count: likedUsers.length }), value: 'liked' },
            { label: t('likes.tab.likedBy', { count: likedByCount }), value: 'likedme' },
          ]}
        />
      </View>

      <FlatList
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={pagerData}
        keyExtractor={(item) => item.key}
        getItemLayout={(_, index) => ({ length: windowWidth, offset: windowWidth * index, index })}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => {
            pagerRef.current?.scrollToIndex({ index, animated: false });
          }, 50);
        }}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(windowWidth, 1));
          const nextTab = pagerData[nextIndex]?.key;

          if (nextTab && nextTab !== activeTab) {
            setActiveTab(nextTab);
            setSwipeStartIndex(null);
          }
        }}
        renderItem={({ item }) => {
          const pageLocked = item.key === 'likedme' && likedByLocked;

          return (
            <View style={[styles.page, { width: windowWidth }]}>
              <FlatList
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.content, { paddingBottom: SCREEN_BOTTOM_SPACING + 82 }]}
                refreshControl={
                  <AppRefreshControl
                    refreshing={refreshing}
                    onRefresh={() => void refresh(true)}
                  />
                }
                data={item.users}
                key={`${item.key}-grid-${gridColumns}`}
                keyExtractor={(entry) => entry.user.id}
                numColumns={gridColumns}
                columnWrapperStyle={gridColumns > 1 ? styles.gridRow : undefined}
                initialNumToRender={8}
                maxToRenderPerBatch={8}
                windowSize={7}
                ListEmptyComponent={
                  <EmptyState
                    icon="heart-outline"
                    title={item.key === 'liked' ? t('likes.empty.liked.title') : t('likes.empty.likedBy.title')}
                    description={t('likes.empty.description')}
                  />
                }
                renderItem={({ item: entry, index }) => (
                  <UserMiniCard
                    user={entry.user}
                    score={entry.score}
                    concealed={pageLocked}
                    concealLabel={t('common.premium')}
                    disabled={false}
                    style={gridColumns === 1 ? styles.fullWidthCard : undefined}
                    onPress={() => {
                      if (pageLocked) {
                        showPopup(t('premium.popup.message'));
                        return;
                      }

                      setActiveTab(item.key);
                      setSwipeStartIndex(index);
                    }}
                  />
                )}
              />
            </View>
          );
        }}
      />

      <SwipeQuotaBar
        remainingLikes={quota.remainingLikes}
        remainingDislikes={quota.remainingDislikes}
        remainingUndos={quota.remainingUndos}
        remainingMs={quota.remainingMs}
        loading={!quota.ready}
        activeKinds={[...activeQuotaKinds]}
        bottomOffset={0}
        respectSafeArea={false}
      />

      {swipeStartIndex != null && !isLikedMeLocked ? (
        <SwipeModal
          users={usersWithScore.map(({ user, score }) => ({ user, score }))}
          instantMatchUserIds={activeTab === 'likedme' ? likedMeUsers.map((user) => user.id) : likedByUserIds}
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
          allowSwipeRight={activeTab === 'likedme'}
          activeQuotaKinds={[...activeQuotaKinds]}
          onSwipeLeftUser={activeTab === 'liked' ? (user) => unlikeUser(user.id) : (user) => rejectIncomingLike(user.id)}
          onSwipeRightUser={activeTab === 'likedme' ? (user) => likeUser(user.id, 'like') : undefined}
        />
      ) : null}

      <TransientPopup message={premiumPopup.message} bottomOffset={0} icon="crown-outline" />
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
  page: {
    flex: 1,
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
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 14,
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
});
