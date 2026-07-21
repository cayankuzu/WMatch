import { memo, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '../context/AuthContext';
import { AppProvider, useWatchSession } from '../context/AppContext';
import { LocalizationProvider, useLocalization } from '../context/LocalizationContext';
import { markChatThreadRead, markNotificationEventRead } from '../services/api';
import {
  getLastNotificationIntent,
  openPushNotificationSettings,
  subscribeToForegroundNotificationPresentation,
  subscribeToNotificationEventInserts,
  subscribeToNotificationResponses,
  subscribeToPushTokenChanges,
  syncPushNotifications,
  type NotificationIntent,
} from '../services/notifications';
import { flushPendingChatMessages } from '../services/chatOutbox';
import { recordTabUsage } from '../services/tabUsage';
import { emitTabReselected } from '../services/tabNavigation';
import { getResidentTabLimit } from '../services/runtimeProfile';
import { clearTabBadges, useTabBadges } from '../services/tabBadges';
import type { Movie } from '../services/tmdb';
import { telemetry } from '../services/telemetry';
import { DEFAULT_BOTTOM_NAV_HEIGHT } from '../shared/constants';
import { performanceBudgets } from '../shared/constants/performance';
import type { AppTab, AuthScreen } from '../shared/types';
import { theme } from '../shared/theme';
import { subscribeToForeground, subscribeToMemoryWarning } from '../shared/utils/appLifecycle';
import { resolveDeviceEdgeInset } from '../shared/utils/safeArea';
import { clearSessionCaches } from '../shared/utils/sessionCache';
import useTransientPopup from './hooks/useTransientPopup';
import useAppDataWarmup, { preloadTabData } from './hooks/useAppDataWarmup';
import useAppPresence from './hooks/useAppPresence';
import useWatchHomeController from './hooks/useWatchHomeController';
import BottomNav from './components/BottomNav';
import CurrentMovieBar from './components/CurrentMovieBar';
import ForgotPasswordScreen from './components/ForgotPasswordScreen';
import LoginScreen from './components/LoginScreen';
import MovieDetailModal from './components/MovieDetailModal';
import PasswordRecoveryScreen from './components/PasswordRecoveryScreen';
import SignUpScreen from './components/SignUpScreen';
import SplashScreen from './components/SplashScreen';
import TransientPopup from './components/ui/TransientPopup';
import VerifyEmailScreen from './components/VerifyEmailScreen';
import WatchScreen from './components/WatchScreen';
import ErrorBoundary from './components/ErrorBoundary';
import ConnectivityBanner from './components/ui/ConnectivityBanner';
import TabScene from './components/ui/TabScene';
import { ChatListSkeleton, SwipeDeckSkeleton, UserGridSkeleton } from './components/ui/Skeleton';
import {
  LazyChatScreen,
  LazyCompatibilityScreen,
  LazyLikesScreen,
  LazyMatchScreen,
  LazyProfileScreen,
  preloadTabModule,
} from './tabModules';

function scheduleIdleWork(work: () => void, timeoutMs = 1200) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const idleCallbackId = globalThis.requestIdleCallback(work, { timeout: timeoutMs });
    return () => globalThis.cancelIdleCallback(idleCallbackId);
  }

  const timeoutId = setTimeout(work, 50);
  return () => clearTimeout(timeoutId);
}

const MemoWatchScreen = memo(WatchScreen);
const MAX_RESIDENT_TABS = getResidentTabLimit();
const TAB_RENDER_ORDER: readonly AppTab[] = [
  'watch',
  'match',
  'compatibility',
  'likes',
  'chat',
  'profile',
];

function AppContent() {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
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
  } = useWatchSession();

  const [authScreen, setAuthScreen] = useState<AuthScreen>('login');
  const [activeTab, setActiveTab] = useState<AppTab>('watch');
  const renderedTab = useDeferredValue(activeTab);
  const [residentTabs, setResidentTabs] = useState<AppTab[]>(['watch']);
  const renderedResidentTabs = TAB_RENDER_ORDER.filter((tab) => residentTabs.includes(tab));
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [bottomNavHeight, setBottomNavHeight] = useState(DEFAULT_BOTTOM_NAV_HEIGHT);
  const [pendingNotificationIntent, setPendingNotificationIntent] = useState<NotificationIntent | null>(null);
  const [requestedChatUserId, setRequestedChatUserId] = useState<string | null>(null);
  const [likesPreferredTab, setLikesPreferredTab] = useState<'liked' | 'likedme' | null>(null);
  const exitBackPressAtRef = useRef(0);
  const tabSwitchStartedAtRef = useRef(0);
  const handledNotificationRequestIdsRef = useRef(new Set<string>());
  const pushSettingsPromptedUserIdsRef = useRef(new Set<string>());
  const { message: exitPopupMessage, showPopup: showExitPopup } = useTransientPopup();
  const watchHome = useWatchHomeController(user, activeTab, activeWatching);
  const tabBadges = useTabBadges();

  useAppPresence(user?.id ?? null);
  useAppDataWarmup(user, activeTab);
  useEffect(() => subscribeToMemoryWarning(() => {
    setResidentTabs([activeTab]);
    clearSessionCaches();
    telemetry.track('app.memory_warning', { activeTab });
  }), [activeTab]);
  const syncCurrentUserPush = useCallback(
    async (userId: string | null | undefined) => {
      const result = await syncPushNotifications(userId);

      if (
        !userId ||
        result.status !== 'settings-required' ||
        pushSettingsPromptedUserIdsRef.current.has(userId)
      ) {
        return;
      }

      pushSettingsPromptedUserIdsRef.current.add(userId);
      Alert.alert(
        t('notifications.permission.title'),
        result.reason === 'channel'
          ? t('notifications.permission.channelDescription')
          : t('notifications.permission.description'),
        [
          {
            text: t('notifications.permission.notNow'),
            style: 'cancel',
          },
          {
            text: t('notifications.permission.openSettings'),
            onPress: () => {
              void openPushNotificationSettings();
            },
          },
        ],
      );
    },
    [t],
  );
  const prepareTab = useCallback((tab: AppTab) => {
    void preloadTabModule(tab).catch((error) => {
      telemetry.captureException(error, { operation: 'tab_module_preload', tab });
    });

    if (!user || tab === activeTab) {
      return;
    }

    void preloadTabData(user, tab, 'intent').catch((error) => {
      telemetry.captureException(error, { operation: 'tab_intent_preload', tab });
    });
  }, [activeTab, user]);
  const switchTab = useCallback((tab: AppTab) => {
    if (tab === activeTab) {
      return;
    }

    tabSwitchStartedAtRef.current = Date.now();
    telemetry.track('navigation.tab_intent', { tab });
    prepareTab(tab);
    setResidentTabs((current) => {
      const next = [...current.filter((item) => item !== tab), tab];
      return next.slice(-MAX_RESIDENT_TABS);
    });
    setActiveTab(tab);
    if (user) {
      recordTabUsage(user.id, tab);
    }
  }, [activeTab, prepareTab, user]);
  const handleTabReselect = useCallback((tab: AppTab) => {
    telemetry.track('navigation.tab_reselected', { tab });
    emitTabReselected(tab);
  }, []);

  useEffect(() => {
    setActiveTab('watch');
    setResidentTabs(['watch']);
    clearTabBadges();
  }, [user?.id]);

  useEffect(() => {
    if (renderedTab !== activeTab || tabSwitchStartedAtRef.current === 0) {
      return;
    }

    telemetry.recordDuration(
      'navigation.tab_committed',
      Date.now() - tabSwitchStartedAtRef.current,
      performanceBudgets.tabCommitMs,
      { tab: activeTab },
    );
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

  useEffect(() => {
    if (!user) {
      return;
    }

    const unsubscribeForeground = subscribeToForeground(() => {
      void watchHome.refreshLiveNow();
      void syncCurrentUserPush(user.id);
      void flushPendingChatMessages(user.id);
    });

    return unsubscribeForeground;
  }, [syncCurrentUserPush, user?.id, watchHome.refreshLiveNow]);

  useEffect(() => {
    void syncCurrentUserPush(user?.id);
    const unsubscribePushTokenChanges = subscribeToPushTokenChanges(user?.id);
    const cancelIdleWork = scheduleIdleWork(() => {
      if (user?.id) {
        void flushPendingChatMessages(user.id);
      }
    });

    return () => {
      cancelIdleWork();
      unsubscribePushTokenChanges();
    };
  }, [syncCurrentUserPush, user?.id]);

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

  const openChatTab = useCallback(() => {
    switchTab('chat');
  }, [switchTab]);

  const openWatchTab = useCallback(() => {
    switchTab('watch');
  }, [switchTab]);

  const renderTab = (tab: AppTab) => {
    switch (tab) {
      case 'watch':
        return (
          <MemoWatchScreen
            userId={user?.id ?? ''}
            isSearching={watchHome.isSearching}
            searchQuery={watchHome.searchQuery}
            searchResults={watchHome.searchResults}
            popularMoviesLoading={watchHome.loadingMovies}
            popularTVLoading={watchHome.loadingTV}
            homeError={watchHome.homeError}
            liveNowError={watchHome.liveNowError}
            liveNowLoading={watchHome.liveNowLoading}
            searchLoading={watchHome.searchLoading}
            searchError={watchHome.searchError}
            liveNowMovies={watchHome.liveNowMovies}
            popularMovies={watchHome.popularMovies}
            popularTVShows={watchHome.popularTVShows}
            viewerCounts={watchHome.viewerCounts}
            viewerProfiles={watchHome.viewerProfiles}
            refreshing={watchHome.refreshingHome}
            onRefresh={watchHome.refreshHome}
            onMovieClick={setSelectedMovie}
            onSearch={watchHome.handleSearch}
            onSearchStateChange={watchHome.setIsSearching}
            onLoadMoreLiveNow={watchHome.canLoadMoreLiveNow ? watchHome.loadMoreLiveNow : undefined}
            onLoadMoreMovies={watchHome.loadMoreMovies}
            onLoadMoreTVShows={watchHome.loadMoreTVShows}
          />
        );
      case 'match':
        return (
          <LazyMatchScreen
            onMovieClick={setSelectedMovie}
            onOpenMessages={openChatTab}
            onBack={openWatchTab}
          />
        );
      case 'compatibility':
        return (
          <LazyCompatibilityScreen
            onMovieClick={setSelectedMovie}
            onOpenMessages={openChatTab}
            onBack={openWatchTab}
          />
        );
      case 'likes':
        return (
          <LazyLikesScreen
            onMovieClick={setSelectedMovie}
            onOpenMessages={openChatTab}
            preferredTab={likesPreferredTab}
          />
        );
      case 'chat':
        return (
          <LazyChatScreen
            onMovieClick={setSelectedMovie}
            requestedOpenUserId={requestedChatUserId}
            onRequestedOpenUserIdHandled={handleRequestedChatUserHandled}
          />
        );
      case 'profile':
        return <LazyProfileScreen onMovieClick={setSelectedMovie} />;
    }
  };

  const renderTabFallback = (tab: AppTab) => {
    if (tab === 'chat') {
      return <ChatListSkeleton />;
    }

    if (tab === 'match' || tab === 'compatibility') {
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
    <View
      style={[
        styles.container,
        {
          paddingTop: resolveDeviceEdgeInset(insets.top),
          paddingRight: Math.max(0, insets.right),
          paddingLeft: Math.max(0, insets.left),
        },
      ]}
    >
      <CurrentMovieBar
        movie={currentlyWatching}
        showEmptyState={activeTab === 'watch'}
        onMovieClick={() => currentlyWatching && setSelectedMovie(currentlyWatching)}
        isActive={watchingState === 'active'}
        watchingUpdatedAt={currentlyWatchingUpdatedAt}
        onPauseWatching={pauseCurrentlyWatching}
        onResumeWatching={resumeCurrentlyWatching}
      />
      <ConnectivityBanner />
      <View style={styles.content}>
        {renderedResidentTabs.map((tab) => {
          const isVisible = tab === renderedTab;

          return (
            <TabScene
              key={tab}
              active={isVisible}
            >
              <Suspense fallback={isVisible ? renderTabFallback(tab) : null}>
                {renderTab(tab)}
              </Suspense>
            </TabScene>
          );
        })}
      </View>
      <BottomNav
        activeTab={activeTab}
        onTabIntent={prepareTab}
        onTabChange={switchTab}
        onTabReselect={handleTabReselect}
        onHeightChange={handleBottomNavHeight}
        badges={tabBadges}
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
    position: 'relative',
  },
});
