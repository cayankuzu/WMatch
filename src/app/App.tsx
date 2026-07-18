import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { AppProvider, useApp } from '../context/AppContext';
import { LocalizationProvider, useLocalization } from '../context/LocalizationContext';
import { markChatThreadRead, markNotificationEventRead } from '../services/api';
import {
  getLastNotificationIntent,
  subscribeToForegroundNotificationPresentation,
  subscribeToNotificationEventInserts,
  subscribeToNotificationResponses,
  syncPushNotifications,
  type NotificationIntent,
} from '../services/notifications';
import { flushPendingChatMessages } from '../services/chatOutbox';
import { getMediaRefKey, getMovieKey, tmdbService, type Movie } from '../services/tmdb';
import { telemetry } from '../services/telemetry';
import { DEFAULT_BOTTOM_NAV_HEIGHT } from '../shared/constants';
import type { AppTab, AuthScreen, ViewerPreview } from '../shared/types';
import { theme } from '../shared/theme';
import useTransientPopup from './hooks/useTransientPopup';
import useAppDataWarmup, { preloadTabData } from './hooks/useAppDataWarmup';
import useAppPresence from './hooks/useAppPresence';
import useLiveNowUsers from './hooks/useLiveNowUsers';
import BottomNav from './components/BottomNav';
import ChatScreen from './components/ChatScreen';
import CompatibilityScreen from './components/CompatibilityScreen';
import CurrentMovieBar from './components/CurrentMovieBar';
import ForgotPasswordScreen from './components/ForgotPasswordScreen';
import LikesScreen from './components/LikesScreen';
import LoginScreen from './components/LoginScreen';
import MatchScreen from './components/MatchScreen';
import MovieDetailModal from './components/MovieDetailModal';
import PasswordRecoveryScreen from './components/PasswordRecoveryScreen';
import ProfileScreen from './components/ProfileScreen';
import SignUpScreen from './components/SignUpScreen';
import SplashScreen from './components/SplashScreen';
import TransientPopup from './components/ui/TransientPopup';
import VerifyEmailScreen from './components/VerifyEmailScreen';
import WatchScreen from './components/WatchScreen';
import ErrorBoundary from './components/ErrorBoundary';
import { ChatListSkeleton, SwipeDeckSkeleton, UserGridSkeleton } from './components/ui/Skeleton';

function getUniqueMovies(movies: Movie[]) {
  const seen = new Set<string>();

  return movies.filter((movie) => {
    const key = getMovieKey(movie);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function mergeUniqueMovies(current: Movie[], incoming: Movie[]) {
  return getUniqueMovies([...current, ...incoming]);
}

function scheduleIdleWork(work: () => void, timeoutMs = 1200) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const idleCallbackId = globalThis.requestIdleCallback(work, { timeout: timeoutMs });
    return () => globalThis.cancelIdleCallback(idleCallbackId);
  }

  const timeoutId = setTimeout(work, 50);
  return () => clearTimeout(timeoutId);
}

const MemoWatchScreen = memo(WatchScreen);
const MemoMatchScreen = memo(MatchScreen);
const MemoCompatibilityScreen = memo(CompatibilityScreen);
const MemoLikesScreen = memo(LikesScreen);
const MemoChatScreen = memo(ChatScreen);
const MemoProfileScreen = memo(ProfileScreen);
const LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE = 6;

function AppContent() {
  const { t } = useLocalization();
  const {
    user,
    loading: authLoading,
    isRecoveringPassword,
    pendingVerificationEmail,
    login,
    signup,
    checkAvailability,
    sendPasswordReset,
    sendVerificationEmail,
    logout,
    completePasswordRecovery,
    cancelPasswordRecovery,
  } = useAuth();
  const {
    currentlyWatching,
    activeWatching,
    currentlyWatchingUpdatedAt,
    watchingState,
    pauseCurrentlyWatching,
    resumeCurrentlyWatching,
    watchingExpiredNotice,
    dismissWatchingExpiredNotice,
  } = useApp();

  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [activeTab, setActiveTab] = useState<AppTab>('watch');
  const renderedTab = useDeferredValue(activeTab);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [moviesPage, setMoviesPage] = useState(1);
  const [tvPage, setTvPage] = useState(1);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingTV, setLoadingTV] = useState(true);
  const [refreshingHome, setRefreshingHome] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [popularMovies, setPopularMovies] = useState<Movie[]>([]);
  const [popularTVShows, setPopularTVShows] = useState<Movie[]>([]);
  const [liveNowMovies, setLiveNowMovies] = useState<Movie[]>([]);
  const [liveNowMediaLoading, setLiveNowMediaLoading] = useState(false);
  const [bottomNavHeight, setBottomNavHeight] = useState(DEFAULT_BOTTOM_NAV_HEIGHT);
  const [pendingNotificationIntent, setPendingNotificationIntent] = useState<NotificationIntent | null>(null);
  const [requestedChatUserId, setRequestedChatUserId] = useState<string | null>(null);
  const [likesPreferredTab, setLikesPreferredTab] = useState<'liked' | 'likedme' | null>(null);
  const exitBackPressAtRef = useRef(0);
  const tabSwitchStartedAtRef = useRef(0);
  const searchRequestSeqRef = useRef(0);
  const handledNotificationRequestIdsRef = useRef(new Set<string>());
  const { message: exitPopupMessage, showPopup: showExitPopup } = useTransientPopup();
  const {
    users: watchUsers,
    pageInfo: liveNowPageInfo,
    loading: liveNowLoading,
    error: liveNowError,
    refresh: refreshLiveNow,
    loadMore: loadMoreLiveNow,
  } = useLiveNowUsers(user?.id ?? null, activeTab === 'watch');

  useAppPresence(user?.id ?? null);
  useAppDataWarmup(user);
  const switchTab = useCallback((tab: AppTab) => {
    if (tab === activeTab) {
      return;
    }

    tabSwitchStartedAtRef.current = Date.now();
    setActiveTab(tab);
    requestAnimationFrame(() => {
      telemetry.track('navigation.tab_intent', { tab });
      if (user) {
        void preloadTabData(user, tab);
      }
    });
  }, [activeTab, user]);

  useEffect(() => {
    if (renderedTab !== activeTab || tabSwitchStartedAtRef.current === 0) {
      return;
    }

    telemetry.track('navigation.tab_committed', {
      tab: activeTab,
      durationMs: Date.now() - tabSwitchStartedAtRef.current,
    });
    tabSwitchStartedAtRef.current = 0;
  }, [activeTab, renderedTab]);

  const handleBottomNavHeight = useCallback((height: number) => {
    if (height <= 0) {
      return;
    }

    setBottomNavHeight((current) => Math.abs(height - current) > 1 ? height : current);
  }, []);

  useEffect(() => {
    if (!authLoading) {
      telemetry.markStartupMilestone('session_ready', { signedIn: Boolean(user) });
    }
  }, [authLoading, user?.id]);

  const loadInitialData = useCallback(async () => {
    setHomeError(null);
    setLoadingMovies(true);
    setLoadingTV(true);

    const results = await Promise.allSettled([
      tmdbService.getPopularMovies(1)
        .then((moviesData) => {
          setPopularMovies(getUniqueMovies(moviesData.results.slice(0, 12)));
          setMoviesPage(1);
          telemetry.markStartupMilestone('popular_movies_ready');
        })
        .finally(() => setLoadingMovies(false)),
      tmdbService.getPopularTVShows(1)
        .then((tvData) => {
          setPopularTVShows(getUniqueMovies(tvData.results.slice(0, 12)));
          setTvPage(1);
          telemetry.markStartupMilestone('popular_tv_ready');
        })
        .finally(() => setLoadingTV(false)),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length > 0) {
      const firstFailure = failures[0].reason;
      setHomeError(firstFailure instanceof Error ? firstFailure.message : t('data.error.generic'));

      if (failures.length === results.length) {
        throw firstFailure;
      }
    }
  }, [t]);

  const refreshHome = useCallback(async () => {
    setRefreshingHome(true);

    try {
      await Promise.allSettled([loadInitialData(), refreshLiveNow({ force: true })]);
    } finally {
      setRefreshingHome(false);
    }
  }, [loadInitialData, refreshLiveNow]);

  const activeWatchingRefs = useMemo(() => {
    const refs: Array<{ id: number; mediaType?: 'movie' | 'tv' | null }> = [];

    if (activeWatching?.id) {
      refs.push({ id: activeWatching.id, mediaType: activeWatching.media_type ?? 'movie' });
    }

    watchUsers.forEach((item) => {
      if (item.currentlyWatching) {
        refs.push({
          id: item.currentlyWatching,
          mediaType: item.currentlyWatchingMediaType ?? 'movie',
        });
      }
    });

    return refs;
  }, [activeWatching?.id, activeWatching?.media_type, watchUsers]);

  const viewerCounts = useMemo(
    () =>
      activeWatchingRefs.reduce<Record<string, number>>((accumulator, ref) => {
        const key = getMediaRefKey(ref);
        accumulator[key] = (accumulator[key] ?? 0) + 1;
        return accumulator;
      }, {}),
    [activeWatchingRefs],
  );

  const viewerProfiles = useMemo(() => {
    const profilesByMovie: Record<string, ViewerPreview[]> = {};

    const addViewer = (
      ref: { id: number; mediaType?: 'movie' | 'tv' | null },
      profile: { id: string; name: string; photos: string[] },
    ) => {
      const key = getMediaRefKey(ref);
      const nextViewer: ViewerPreview = {
        id: profile.id,
        name: profile.name,
        photo: profile.photos.find((photo) => photo.trim().length > 0) ?? null,
      };

      const currentViewers = profilesByMovie[key] ?? [];

      if (currentViewers.some((viewer) => viewer.id === nextViewer.id)) {
        return;
      }

      profilesByMovie[key] = [...currentViewers, nextViewer];
    };

    if (user && activeWatching?.id) {
      addViewer({ id: activeWatching.id, mediaType: activeWatching.media_type ?? 'movie' }, user);
    }

    watchUsers.forEach((item) => {
      if (item.currentlyWatching) {
        addViewer(
          {
            id: item.currentlyWatching,
            mediaType: item.currentlyWatchingMediaType ?? 'movie',
          },
          item,
        );
      }
    });

    return profilesByMovie;
  }, [activeWatching?.id, activeWatching?.media_type, user, watchUsers]);

  useEffect(() => {
    if (!user) {
      return;
    }

    void loadInitialData().catch((error) => {
      console.warn('Initial media data could not be loaded:', error);
    });
  }, [loadInitialData, user?.id]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshLiveNow();
        void syncPushNotifications(user.id);
        void flushPendingChatMessages(user.id);
      }
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [refreshLiveNow, user?.id]);

  useEffect(() => {
    const cancelIdleWork = scheduleIdleWork(() => {
      void syncPushNotifications(user?.id);
      if (user?.id) {
        void flushPendingChatMessages(user.id);
      }
    });

    return cancelIdleWork;
  }, [user?.id]);

  useEffect(() => {
    const unsubscribeForegroundPresentation = subscribeToForegroundNotificationPresentation();

    return () => {
      unsubscribeForegroundPresentation();
    };
  }, []);

  useEffect(() => {
    const unsubscribeNotificationEvents = subscribeToNotificationEventInserts(user?.id);

    return () => {
      unsubscribeNotificationEvents();
    };
  }, [user?.id]);

  const queueNotificationIntent = useCallback((intent: NotificationIntent | null) => {
    if (!intent || handledNotificationRequestIdsRef.current.has(intent.requestId)) {
      return;
    }

    handledNotificationRequestIdsRef.current.add(intent.requestId);
    setPendingNotificationIntent(intent);
  }, []);

  const handleRequestedChatUserHandled = useCallback((userId: string) => {
    setRequestedChatUserId((current) => (current === userId ? null : current));
  }, []);

  useEffect(() => {
    let mounted = true;

    void getLastNotificationIntent().then((intent) => {
      if (mounted) {
        queueNotificationIntent(intent);
      }
    });

    const unsubscribe = subscribeToNotificationResponses((intent) => {
      queueNotificationIntent(intent);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [queueNotificationIntent]);

  useEffect(() => {
    if (user) {
      return;
    }

    setPendingNotificationIntent(null);
    setRequestedChatUserId(null);
    setLikesPreferredTab(null);
  }, [user]);

  useEffect(() => {
    if (!user || !pendingNotificationIntent) {
      return;
    }

    let cancelled = false;
    const nextIntent = pendingNotificationIntent;
    const readTasks: Array<Promise<void>> = [];

    setSelectedMovie(null);

    if (nextIntent.target === 'likes') {
      setLikesPreferredTab(nextIntent.preferredTab);
      switchTab('likes');
    } else {
      setRequestedChatUserId(nextIntent.userId);
      switchTab('chat');

      if (nextIntent.markThreadRead) {
        readTasks.push(markChatThreadRead(nextIntent.userId));
      }
    }

    if (nextIntent.eventId) {
      readTasks.push(markNotificationEventRead(nextIntent.eventId));
    }

    void Promise.allSettled(readTasks).finally(() => {
      if (!cancelled) {
        setPendingNotificationIntent((current) =>
          current?.requestId === nextIntent.requestId ? null : current,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pendingNotificationIntent, switchTab, user]);

  useEffect(() => {
    if (activeTab === 'likes' || likesPreferredTab == null) {
      return;
    }

    setLikesPreferredTab(null);
  }, [activeTab, likesPreferredTab]);

  useEffect(() => {
    const cancelIdleWork = scheduleIdleWork(() => {
      void tmdbService.prefetchMovieArtwork(
        [...popularMovies, ...popularTVShows].slice(0, 16),
        { posterSize: 'w200' },
      );
    });

    return cancelIdleWork;
  }, [popularMovies, popularTVShows]);

  useEffect(() => {
    if (liveNowMovies.length === 0) {
      return;
    }

    const cancelIdleWork = scheduleIdleWork(() => {
      void tmdbService.prefetchMovieArtwork(liveNowMovies.slice(0, 12), {
        includeBackdrop: true,
        posterSize: 'w200',
        backdropSize: 'w500',
      });
    });

    return cancelIdleWork;
  }, [liveNowMovies]);

  useEffect(() => {
    if (searchResults.length === 0) {
      return;
    }

    const cancelIdleWork = scheduleIdleWork(() => {
      void tmdbService.prefetchMovieArtwork(searchResults.slice(0, 12), { posterSize: 'w200' });
    });

    return cancelIdleWork;
  }, [searchResults]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateLiveNowMovies() {
      const seenRefs = new Set<string>();
      const uniqueRefs = activeWatchingRefs.filter((ref) => {
        const key = getMediaRefKey(ref);

        if (seenRefs.has(key)) {
          return false;
        }

        seenRefs.add(key);
        return true;
      });

      if (uniqueRefs.length === 0) {
        setLiveNowMovies([]);
        setLiveNowMediaLoading(false);
        return;
      }

      const lookup = new Map<string, Movie>();

      [...popularMovies, ...popularTVShows].forEach((movie) => {
        const key = getMovieKey(movie);

        if (!lookup.has(key)) {
          lookup.set(key, movie);
        }
      });

      const missingRefs = uniqueRefs.filter((ref) => !lookup.has(getMediaRefKey(ref)));

      const commitResolvedMovies = () => {
        if (cancelled) {
          return;
        }

        setLiveNowMovies(
          uniqueRefs
            .map((ref) => lookup.get(getMediaRefKey(ref)))
            .filter((movie): movie is Movie => movie != null),
        );
      };

      commitResolvedMovies();

      if (missingRefs.length > 0) {
        setLiveNowMediaLoading(true);

        for (let index = 0; index < missingRefs.length; index += LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE) {
          const batch = missingRefs.slice(index, index + LIVE_NOW_MEDIA_HYDRATION_BATCH_SIZE);

          try {
            const fetchedMovies = await Promise.all(batch.map((ref) => tmdbService.getMediaByRef(ref)));
            fetchedMovies.forEach((movie) => {
              if (movie) {
                lookup.set(getMovieKey(movie), movie);
              }
            });
            commitResolvedMovies();
          } catch (error) {
            console.warn('Live now media batch could not be hydrated:', error);
          }
        }
      }

      if (!cancelled) {
        commitResolvedMovies();
        setLiveNowMediaLoading(false);
      }
    }

    void hydrateLiveNowMovies();

    return () => {
      cancelled = true;
    };
  }, [activeWatchingRefs, popularMovies, popularTVShows]);

  useEffect(() => {
    if (!watchingExpiredNotice) {
      return;
    }

    Alert.alert(t('app.watch.expired.title'), watchingExpiredNotice, [{ text: t('common.ok') }]);
    dismissWatchingExpiredNotice();
  }, [dismissWatchingExpiredNotice, t, watchingExpiredNotice]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedMovie) {
        setSelectedMovie(null);
        return true;
      }

      if (!user) {
        if (authScreen !== 'login') {
          setAuthScreen('login');
          return true;
        }
      } else if (activeTab !== 'watch') {
        switchTab('watch');
        return true;
      }

      const now = Date.now();

      if (now - exitBackPressAtRef.current < 1800) {
        BackHandler.exitApp();
        return true;
      }

      exitBackPressAtRef.current = now;
      showExitPopup(t('app.exit.confirm'));
      return true;
    });

    return () => subscription.remove();
  }, [activeTab, authScreen, selectedMovie, showExitPopup, switchTab, t, user]);

  const loadMoreMovies = useCallback(async () => {
    if (loadingMovies) {
      return;
    }

    setLoadingMovies(true);

    try {
      const nextPage = moviesPage + 1;
      const data = await tmdbService.getPopularMovies(nextPage);
      setPopularMovies((current) => mergeUniqueMovies(current, data.results.slice(0, 12)));
      setMoviesPage(nextPage);
      setHomeError(null);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t('data.error.generic'));
    } finally {
      setLoadingMovies(false);
    }
  }, [loadingMovies, moviesPage, t]);

  const loadMoreTVShows = useCallback(async () => {
    if (loadingTV) {
      return;
    }

    setLoadingTV(true);

    try {
      const nextPage = tvPage + 1;
      const data = await tmdbService.getPopularTVShows(nextPage);
      setPopularTVShows((current) => mergeUniqueMovies(current, data.results.slice(0, 12)));
      setTvPage(nextPage);
      setHomeError(null);
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : t('data.error.generic'));
    } finally {
      setLoadingTV(false);
    }
  }, [loadingTV, t, tvPage]);

  const handleWatchRefresh = useCallback(() => {
    void refreshHome();
  }, [refreshHome]);

  const handleLoadMoreLiveNow = useCallback(() => {
    void loadMoreLiveNow();
  }, [loadMoreLiveNow]);

  const openChatTab = useCallback(() => {
    switchTab('chat');
  }, [switchTab]);

  const openWatchTab = useCallback(() => {
    switchTab('watch');
  }, [switchTab]);

  const handleSearch = useCallback(async (query: string, filter: 'all' | 'movie' | 'tv') => {
    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;
    const normalizedQuery = query.trim();
    setSearchQuery(normalizedQuery);
    setIsSearching(Boolean(normalizedQuery));
    setSearchError(null);

    if (!normalizedQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      setIsSearching(false);
      return;
    }

    setSearchLoading(true);

    try {
      const response = filter === 'movie'
        ? await tmdbService.searchMovies(normalizedQuery, 1)
        : filter === 'tv'
          ? await tmdbService.searchTVShows(normalizedQuery, 1)
          : await tmdbService.searchMulti(normalizedQuery, 1);

      if (searchRequestSeqRef.current !== requestSeq) {
        return;
      }

      setSearchResults(getUniqueMovies(response.results.slice(0, 12)));
    } catch (error) {
      if (searchRequestSeqRef.current === requestSeq) {
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : t('data.error.generic'));
      }
    } finally {
      if (searchRequestSeqRef.current === requestSeq) {
        setSearchLoading(false);
      }
    }
  }, [t]);

  const renderActiveScreen = () => {
    switch (renderedTab) {
      case 'watch':
        return (
          <MemoWatchScreen
            isSearching={isSearching}
            searchQuery={searchQuery}
            searchResults={searchResults}
            popularMoviesLoading={loadingMovies}
            popularTVLoading={loadingTV}
            homeError={homeError}
            liveNowError={liveNowError}
            liveNowLoading={liveNowLoading || liveNowMediaLoading}
            searchLoading={searchLoading}
            searchError={searchError}
            liveNowMovies={liveNowMovies}
            popularMovies={popularMovies}
            popularTVShows={popularTVShows}
            viewerCounts={viewerCounts}
            viewerProfiles={viewerProfiles}
            refreshing={refreshingHome}
            onRefresh={handleWatchRefresh}
            onMovieClick={setSelectedMovie}
            onSearch={handleSearch}
            onSearchStateChange={setIsSearching}
            onLoadMoreLiveNow={liveNowPageInfo.hasMore ? handleLoadMoreLiveNow : undefined}
            onLoadMoreMovies={loadMoreMovies}
            onLoadMoreTVShows={loadMoreTVShows}
          />
        );
      case 'match':
        return (
          <MemoMatchScreen
            onMovieClick={setSelectedMovie}
            onOpenMessages={openChatTab}
            onBack={openWatchTab}
          />
        );
      case 'compatibility':
        return (
          <MemoCompatibilityScreen
            onMovieClick={setSelectedMovie}
            onOpenMessages={openChatTab}
          />
        );
      case 'likes':
        return (
          <MemoLikesScreen
            onMovieClick={setSelectedMovie}
            onOpenMessages={openChatTab}
            preferredTab={likesPreferredTab}
          />
        );
      case 'chat':
        return (
          <MemoChatScreen
            onMovieClick={setSelectedMovie}
            requestedOpenUserId={requestedChatUserId}
            onRequestedOpenUserIdHandled={handleRequestedChatUserHandled}
          />
        );
      case 'profile':
        return <MemoProfileScreen onMovieClick={setSelectedMovie} />;
    }
  };

  const renderTabTransition = () => {
    if (activeTab === 'chat') {
      return <ChatListSkeleton />;
    }

    if (activeTab === 'match') {
      return <SwipeDeckSkeleton />;
    }

    return <UserGridSkeleton count={4} />;
  };

  if (authLoading) {
    return <SplashScreen />;
  }

  if (isRecoveringPassword) {
    return (
      <PasswordRecoveryScreen
        onSubmit={completePasswordRecovery}
        onCancel={cancelPasswordRecovery}
      />
    );
  }

  if (pendingVerificationEmail || (user && !user.emailVerified)) {
    return (
      <VerifyEmailScreen
        email={pendingVerificationEmail ?? user?.email ?? ''}
        onResendEmail={() => sendVerificationEmail(pendingVerificationEmail ?? user?.email ?? '')}
        onLogout={logout}
      />
    );
  }

  if (!user) {
    if (authScreen === 'signup') {
      return (
        <SignUpScreen
          onSignUp={signup}
          onCheckAvailability={checkAvailability}
          onBackToLogin={() => setAuthScreen('login')}
        />
      );
    }

    if (authScreen === 'forgot') {
      return (
        <ForgotPasswordScreen
          onSendResetEmail={sendPasswordReset}
          onBackToLogin={() => setAuthScreen('login')}
        />
      );
    }

    return (
      <LoginScreen
        onLogin={login}
        onSignUp={() => setAuthScreen('signup')}
        onForgotPassword={() => setAuthScreen('forgot')}
      />
    );
  }

  return (
    <View style={styles.container}>
      <CurrentMovieBar
        movie={currentlyWatching}
        onMovieClick={() => currentlyWatching && setSelectedMovie(currentlyWatching)}
        isActive={watchingState === 'active'}
        watchingUpdatedAt={currentlyWatchingUpdatedAt}
        onPauseWatching={pauseCurrentlyWatching}
        onResumeWatching={resumeCurrentlyWatching}
      />
      <View style={styles.content}>
        {renderedTab === activeTab ? renderActiveScreen() : renderTabTransition()}
      </View>
      <BottomNav
        activeTab={activeTab}
        onTabChange={switchTab}
        onHeightChange={handleBottomNavHeight}
      />
      <TransientPopup message={exitPopupMessage} bottomOffset={bottomNavHeight} icon="logout-variant" />
      <MovieDetailModal movie={selectedMovie} onClose={() => setSelectedMovie(null)} />
    </View>
  );
}

export default function App() {
  return (
    <LocalizationProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AppProvider>
            <AppContent />
          </AppProvider>
        </AuthProvider>
      </ErrorBoundary>
    </LocalizationProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
  },
});
