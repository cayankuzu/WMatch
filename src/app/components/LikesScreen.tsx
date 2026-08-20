import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLibrary } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { likeUser, rejectIncomingLike, unlikeUser } from '../../services/api';
import { setTabBadge } from '../../services/tabBadges';
import {
  hydrateScreenSessionState,
  patchScreenSessionState,
  readScreenSessionState,
} from '../../services/screenSessionState';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import { movieToMediaRef, type Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import { calculateCompatibilityScore } from '../../shared/utils/compatibility';
import { getFixedGridItemWidth } from '../../shared/utils/grid';
import useDiscoveryData from '../hooks/useDiscoveryData';
import useTransientPopup from '../hooks/useTransientPopup';
import useSwipeQuota from '../hooks/useSwipeQuota';
import SwipeModal from './SwipeModal';
import SwipeQuotaBar from './SwipeQuotaBar';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import SegmentedControl from './ui/SegmentedControl';
import { UserGridSkeleton } from './ui/Skeleton';
import TransientPopup from './ui/TransientPopup';
import ScreenHeader from './ui/ScreenHeader';
import useTabReselect from '../hooks/useTabReselect';
import LikesGridPage, { type ScoredUser } from './likes/LikesGridPage';

interface LikesScreenProps {
  onMovieClick?: (movie: Movie) => void;
  onOpenMessages?: () => void;
  preferredTab?: 'liked' | 'likedme' | null;
}

const LIKES_GRID_COLUMNS = 3;
const LIKES_COMPACT_BREAKPOINT = 350;

export default function LikesScreen({
  onMovieClick,
  onOpenMessages,
  preferredTab = null,
}: LikesScreenProps) {
  const { t } = useLocalization();
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const pageWidth = measuredWidth || windowWidth;
  const gridColumns = pageWidth < LIKES_COMPACT_BREAKPOINT ? 2 : LIKES_GRID_COLUMNS;
  const { user: currentUser } = useAuth();
  const initialScreenState = currentUser
    ? readScreenSessionState(currentUser.id, 'likes')
    : null;
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
  const [activeTab, setActiveTab] = useState<'liked' | 'likedme'>(
    initialScreenState?.activeTab ?? 'liked',
  );
  const [swipeStartIndex, setSwipeStartIndex] = useState<number | null>(null);
  const pagerRef = useRef<FlatList<{ key: 'liked' | 'likedme'; users: ScoredUser[] }> | null>(null);
  const gridRefs = useRef<Partial<Record<'liked' | 'likedme', FlatList<ScoredUser> | null>>>({});
  const gridScrollOffsetsRef = useRef({
    liked: initialScreenState?.likedScrollOffset ?? 0,
    likedme: initialScreenState?.likedMeScrollOffset ?? 0,
  });
  const premiumPopup = useTransientPopup();
  const { showPopup } = premiumPopup;
  const gridContentWidth = Math.max(1, pageWidth - SCREEN_SIDE_SPACING * 2);
  const gridItemWidth = getFixedGridItemWidth(
    gridContentWidth,
    gridColumns,
    theme.layout.cardGap,
  );
  const gridItemStyle = useMemo(
    () => ({ flex: 0, width: gridItemWidth }),
    [gridItemWidth],
  );
  const favoriteMedia = useMemo(() => favorites.map(movieToMediaRef), [favorites]);
  const watchedMedia = useMemo(() => watched.map(movieToMediaRef), [watched]);

  const likedMeUsers = likedByUsers;
  const activeQuotaKinds = activeTab === 'liked' ? ['dislike'] as const : ['like', 'dislike'] as const;
  const isLikedMeLocked = activeTab === 'likedme' && likedByLocked;
  const scrollActiveListToTop = useCallback(() => {
    gridRefs.current[activeTab]?.scrollToOffset({ offset: 0, animated: true });
    gridScrollOffsetsRef.current[activeTab] = 0;
    if (currentUser) {
      patchScreenSessionState(currentUser.id, 'likes', {
        [activeTab === 'liked' ? 'likedScrollOffset' : 'likedMeScrollOffset']: 0,
      });
    }
  }, [activeTab, currentUser?.id]);
  const handleScreenLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;

    setMeasuredWidth((currentWidth) =>
      Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth,
    );
  }, []);
  const handleGridScroll = useCallback((page: 'liked' | 'likedme', scrollOffset: number) => {
    gridScrollOffsetsRef.current[page] = scrollOffset;
    if (currentUser) {
      patchScreenSessionState(currentUser.id, 'likes', {
        [page === 'liked' ? 'likedScrollOffset' : 'likedMeScrollOffset']: scrollOffset,
      });
    }
  }, [currentUser?.id]);
  const handleGridItemPress = useCallback((page: 'liked' | 'likedme', index: number) => {
    if (page === 'likedme' && likedByLocked) {
      showPopup(t('premium.popup.message'));
      return;
    }

    setActiveTab(page);
    setSwipeStartIndex(index);
  }, [likedByLocked, showPopup, t]);

  useTabReselect('likes', scrollActiveListToTop);

  useEffect(() => {
    setTabBadge('likes', likedByCount);
  }, [likedByCount]);

  useEffect(() => {
    if (!currentUser) {
      setActiveTab('liked');
      gridScrollOffsetsRef.current = { liked: 0, likedme: 0 };
      return;
    }

    let cancelled = false;
    const applyScreenState = (screenState: ReturnType<typeof readScreenSessionState<'likes'>>) => {
      setActiveTab(screenState.activeTab);
      gridScrollOffsetsRef.current = {
        liked: screenState.likedScrollOffset,
        likedme: screenState.likedMeScrollOffset,
      };
      requestAnimationFrame(() => {
        if (!cancelled) {
          pagerRef.current?.scrollToIndex({
            index: screenState.activeTab === 'liked' ? 0 : 1,
            animated: false,
          });
        }
      });
    };

    applyScreenState(readScreenSessionState(currentUser.id, 'likes'));
    void hydrateScreenSessionState(currentUser.id, 'likes').then((screenState) => {
      if (!cancelled) {
        applyScreenState(screenState);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

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
    if (currentUser) {
      patchScreenSessionState(currentUser.id, 'likes', { activeTab: preferredTab });
    }
    pagerRef.current?.scrollToIndex({
      index: preferredTab === 'liked' ? 0 : 1,
      animated: false,
    });
  }, [activeTab, currentUser?.id, preferredTab]);

  if (loading && usersWithScore.length === 0) {
    return (
      <SafeAreaView edges={[]} style={styles.safeArea}>
        <UserGridSkeleton columns={gridColumns} />
      </SafeAreaView>
    );
  }

  if (status === 'error' && error && usersWithScore.length === 0) {
    return (
      <SafeAreaView edges={[]} style={styles.safeArea}>
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
    if (currentUser) {
      patchScreenSessionState(currentUser.id, 'likes', { activeTab: nextTab });
    }
    pagerRef.current?.scrollToIndex({
      index: nextTab === 'liked' ? 0 : 1,
      animated: true,
    });
  };

  return (
    <SafeAreaView edges={[]} onLayout={handleScreenLayout} style={styles.safeArea}>
      <View style={styles.header}>
        {stale ? (
          <DataWarningBanner
            title={t('data.stale.title')}
            description={t('data.stale.description')}
            actionLabel={t('data.action.retry')}
            onAction={() => void refresh(true)}
          />
        ) : null}
        <ScreenHeader title={t('likes.title')} subtitle={t('likes.subtitle')} />
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
        getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => {
            pagerRef.current?.scrollToIndex({ index, animated: false });
          }, 50);
        }}
        onMomentumScrollEnd={(event) => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(pageWidth, 1));
          const nextTab = pagerData[nextIndex]?.key;

          if (nextTab && nextTab !== activeTab) {
            setActiveTab(nextTab);
            setSwipeStartIndex(null);
            if (currentUser) {
              patchScreenSessionState(currentUser.id, 'likes', { activeTab: nextTab });
            }
          }
        }}
        renderItem={({ item }) => (
          <LikesGridPage
            columns={gridColumns}
            concealed={item.key === 'likedme' && likedByLocked}
            initialOffset={gridScrollOffsetsRef.current[item.key]}
            itemStyle={gridItemStyle}
            listRef={(instance) => {
              gridRefs.current[item.key] = instance;
            }}
            pageKey={item.key}
            pageWidth={pageWidth}
            refreshing={refreshing}
            users={item.users}
            onItemPress={handleGridItemPress}
            onRefresh={() => void refresh(true)}
            onScrollOffset={handleGridScroll}
          />
        )}
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
          modeTitle={t('likes.title')}
          modeSubtitle={activeTab === 'liked' ? t('likes.mode.liked') : t('likes.mode.likedBy')}
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
  header: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 10,
    gap: 4,
  },
});
