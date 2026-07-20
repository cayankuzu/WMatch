import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useLibrary } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { getMovieKey, legacyMovieIdsToRefs, movieToMediaRef, tmdbService, type Movie } from '../../services/tmdb';
import type { ApiUser, MatchContextSnapshot, MediaRef } from '../../shared/types';
import { theme } from '../../shared/theme';
import { getCompatibilityBreakdown } from '../../shared/utils/compatibility';
import { getCompatibilityStyle } from '../../shared/theme/compatibility';
import CompatibilitySheet from './CompatibilitySheet';
import MatchContextSheet from './MatchContextSheet';
import ProfileCard from './ProfileCard';

interface ProfileViewerProps {
  user: ApiUser;
  onMovieClick?: (movie: Movie) => void;
  matchContext?: MatchContextSnapshot | null;
  swipeEnabled?: boolean;
  allowSwipeLeft?: boolean;
  allowSwipeRight?: boolean;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  onBack?: () => void;
  onHeaderRightPress?: () => void;
  headerRightIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onSecondaryHeaderRightPress?: () => void;
  secondaryHeaderRightIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomInset?: number;
}

export default function ProfileViewer({
  user,
  onMovieClick,
  matchContext = null,
  swipeEnabled = false,
  allowSwipeLeft = true,
  allowSwipeRight = true,
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
  onBack,
  onHeaderRightPress,
  headerRightIcon,
  onSecondaryHeaderRightPress,
  secondaryHeaderRightIcon,
  refreshing = false,
  onRefresh,
  bottomInset = 0,
}: ProfileViewerProps) {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const { favorites: currentFavorites, watched: currentWatched } = useLibrary();
  const [favorites, setFavorites] = useState<Movie[]>([]);
  const [watched, setWatched] = useState<Movie[]>([]);
  const [showCompatibility, setShowCompatibility] = useState(false);
  const [showMatchContext, setShowMatchContext] = useState(false);
  const [matchContextMovie, setMatchContextMovie] = useState<Movie | null>(null);
  const [mediaLoadFailed, setMediaLoadFailed] = useState(false);
  const [mediaLoadAttempt, setMediaLoadAttempt] = useState(0);
  const currentFavoriteMedia = useMemo(() => currentFavorites.map(movieToMediaRef), [currentFavorites]);
  const currentWatchedMedia = useMemo(() => currentWatched.map(movieToMediaRef), [currentWatched]);
  const userFavoriteMedia = useMemo<MediaRef[]>(
    () => (user.favoriteMedia?.length ? user.favoriteMedia : legacyMovieIdsToRefs(user.favoriteMovies ?? [])),
    [user.favoriteMedia, user.favoriteMovies],
  );
  const userWatchedMedia = useMemo<MediaRef[]>(
    () => (user.watchedMedia?.length ? user.watchedMedia : legacyMovieIdsToRefs(user.watchedMovies ?? [])),
    [user.watchedMedia, user.watchedMovies],
  );
  const matchStyle = getCompatibilityStyle(matchContext?.compatibilityScore ?? 0);

  useEffect(() => {
    setShowCompatibility(false);
    setShowMatchContext(false);
  }, [user.id]);

  useEffect(() => {
    const matchedMovieId = matchContext?.matchedMovieId ?? null;

    if (matchedMovieId == null) {
      setMatchContextMovie(null);
      return;
    }

    const movieId = matchedMovieId;
    let cancelled = false;
    setMatchContextMovie(null);

    async function loadMatchContextMovie() {
      try {
        const movie = await tmdbService.getMediaById(movieId);

        if (cancelled) {
          return;
        }

        setMatchContextMovie(movie);
      } catch {
        if (!cancelled) {
          setMediaLoadFailed(true);
        }
      }
    }

    void loadMatchContextMovie();

    return () => {
      cancelled = true;
    };
  }, [matchContext?.matchedMovieId, mediaLoadAttempt]);

  useEffect(() => {
    let cancelled = false;
    setMediaLoadFailed(false);

    async function loadMedia() {
      try {
        const [favoriteMovies, watchedMovies] = await Promise.all([
          tmdbService.getMediaListByRefs(userFavoriteMedia),
          tmdbService.getMediaListByRefs(userWatchedMedia),
        ]);

        if (cancelled) {
          return;
        }

        setFavorites(favoriteMovies);
        setWatched(watchedMovies);
      } catch {
        if (!cancelled) {
          setMediaLoadFailed(true);
        }
      }
    }

    void loadMedia();

    return () => {
      cancelled = true;
    };
  }, [mediaLoadAttempt, user.id, userFavoriteMedia, userWatchedMedia]);

  const compatibility = useMemo(() => {
    if (!currentUser || currentUser.id === user.id) {
      return null;
    }

    return getCompatibilityBreakdown(
      currentFavoriteMedia,
      currentWatchedMedia,
      userFavoriteMedia,
      userWatchedMedia,
    );
  }, [currentFavoriteMedia, currentUser, currentWatchedMedia, user.id, userFavoriteMedia, userWatchedMedia]);

  const commonFavorites = useMemo(() => {
    if (!compatibility) {
      return [];
    }

    const commonIds = new Set(compatibility.commonFavoriteIds);
    const typedCommonKeys = new Set(compatibility.commonFavoriteRefs.map((item) => `${item.mediaType}:${item.id}`));
    const commonKeys = new Set(userFavoriteMedia.map((item) => `${item.mediaType}:${item.id}`));
    return favorites.filter((movie) => typedCommonKeys.has(getMovieKey(movie)) || (commonIds.has(movie.id) && commonKeys.has(getMovieKey(movie))));
  }, [compatibility, favorites, userFavoriteMedia]);

  const commonWatched = useMemo(() => {
    if (!compatibility) {
      return [];
    }

    const commonIds = new Set(compatibility.commonWatchedIds);
    const typedCommonKeys = new Set(compatibility.commonWatchedRefs.map((item) => `${item.mediaType}:${item.id}`));
    const commonKeys = new Set(userWatchedMedia.map((item) => `${item.mediaType}:${item.id}`));
    return watched.filter((movie) => typedCommonKeys.has(getMovieKey(movie)) || (commonIds.has(movie.id) && commonKeys.has(getMovieKey(movie))));
  }, [compatibility, userWatchedMedia, watched]);

  const matchContextTitle = useMemo(() => {
    if (!matchContext) {
      return null;
    }

    if (matchContext.type === 'compatibility') {
      return t('profile.viewer.matchType.compatibility');
    }

    if (matchContext.type === 'watch') {
      return t('profile.viewer.matchType.watch');
    }

    return t('profile.viewer.matchType.like');
  }, [matchContext, t]);

  const matchContextSummary = useMemo(() => {
    if (!matchContext) {
      return null;
    }

    if (matchContext.type === 'compatibility') {
      return t('profile.viewer.matchSummary.compatibility');
    }

    if (matchContextMovie) {
      return t('profile.viewer.matchSummary.watchMovie', {
        title: matchContextMovie.title || matchContextMovie.name || t('movie.detail.untitled'),
      });
    }

    if (matchContext.type === 'watch') {
      return matchContext.compatibilityScore != null
        ? t('profile.viewer.matchSummary.watchScore', { score: matchContext.compatibilityScore })
        : t('profile.viewer.matchSummary.watch');
    }

    return matchContext.compatibilityScore != null
      ? t('profile.viewer.matchSummary.likeScore', { score: matchContext.compatibilityScore })
      : t('profile.viewer.matchSummary.like');
  }, [matchContext, matchContextMovie, t]);

  const matchContextSection = matchContext && matchContextTitle ? (
    <Pressable onPress={() => setShowMatchContext(true)} style={styles.matchContextCard}>
      <View style={styles.matchContextHeader}>
        <View style={styles.matchContextLabelRow}>
          <MaterialCommunityIcons
            name={matchContext.type === 'compatibility' ? 'chart-line' : 'cards-heart'}
            size={16}
            color={matchContext.type === 'compatibility' ? matchStyle.color : theme.colors.primarySoft}
          />
          <Text style={styles.matchContextLabel}>{matchContextTitle}</Text>
        </View>
        <View style={styles.matchContextMeta}>
          {matchContext.compatibilityScore != null ? (
            <Text style={[styles.matchContextScore, { color: matchStyle.color }]}>%{matchContext.compatibilityScore}</Text>
          ) : null}
          <MaterialCommunityIcons name="chevron-right" size={18} color={theme.colors.textMuted} />
        </View>
      </View>

      <View style={styles.matchContextBody}>
        {matchContextSummary ? <Text style={styles.matchContextSummary}>{matchContextSummary}</Text> : null}
        <Text style={styles.matchContextHint}>{t('profile.viewer.matchHint')}</Text>
        {matchContext.compatibilityScore != null ? (
          <View style={[styles.matchContextTrack, { backgroundColor: matchStyle.track }]}>
            <View
              style={[
                styles.matchContextFill,
                {
                  width: `${Math.min(matchContext.compatibilityScore, 100)}%`,
                  backgroundColor: matchStyle.color,
                },
              ]}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  ) : null;
  const mediaFailureSection = mediaLoadFailed ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('data.error.title')}. ${t('data.action.retry')}`}
      onPress={() => setMediaLoadAttempt((current) => current + 1)}
      style={styles.mediaFailureCard}
    >
      <MaterialCommunityIcons name="cloud-alert-outline" size={18} color={theme.colors.dangerText} />
      <View style={styles.mediaFailureCopy}>
        <Text accessibilityRole="alert" style={styles.mediaFailureTitle}>{t('data.error.title')}</Text>
        <Text style={styles.mediaFailureAction}>{t('data.action.retry')}</Text>
      </View>
    </Pressable>
  ) : null;

  return (
    <>
      <ProfileCard
        user={user}
        favorites={favorites}
        watched={watched}
        beforeCompatibilitySection={
          mediaFailureSection || matchContextSection ? (
            <View style={styles.beforeCompatibilitySections}>
              {mediaFailureSection}
              {matchContextSection}
            </View>
          ) : null
        }
        onMovieClick={onMovieClick}
        showCompatibility={compatibility != null}
        compatibilityScore={compatibility?.score ?? 0}
        onCompatibilityClick={() => setShowCompatibility(true)}
        swipeable={swipeEnabled}
        allowSwipeLeft={allowSwipeLeft}
        allowSwipeRight={allowSwipeRight}
        onSwipeDown={onSwipeDown}
        onHeaderBack={onBack}
        onHeaderRightPress={onHeaderRightPress}
        headerRightIcon={headerRightIcon}
        onSecondaryHeaderRightPress={onSecondaryHeaderRightPress}
        secondaryHeaderRightIcon={secondaryHeaderRightIcon}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onSwipeLeft={onSwipeLeft}
        onSwipeRight={onSwipeRight}
        bottomInset={bottomInset}
      />

      {compatibility ? (
        <CompatibilitySheet
          visible={showCompatibility}
          user={user}
          score={compatibility.score}
          favorites={commonFavorites}
          watched={commonWatched}
          onClose={() => setShowCompatibility(false)}
          onMovieClick={onMovieClick}
        />
      ) : null}

      {matchContext && currentUser ? (
        <MatchContextSheet
          visible={showMatchContext}
          context={matchContext}
          currentUserId={currentUser.id}
          otherUserName={user.name}
          onClose={() => setShowMatchContext(false)}
          onMovieClick={onMovieClick}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  beforeCompatibilitySections: {
    gap: 10,
  },
  mediaFailureCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.dangerSurface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mediaFailureCopy: {
    flex: 1,
  },
  mediaFailureTitle: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.caption,
    fontWeight: '800',
  },
  mediaFailureAction: {
    color: theme.colors.text,
    fontSize: theme.typography.caption,
    fontWeight: '700',
  },
  matchContextCard: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 14,
    gap: 10,
  },
  matchContextHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  matchContextLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchContextMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  matchContextLabel: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '800',
  },
  matchContextScore: {
    fontSize: 18,
    fontWeight: '900',
  },
  matchContextBody: {
    gap: 8,
  },
  matchContextSummary: {
    color: theme.colors.text,
    fontSize: theme.typography.caption,
    fontWeight: '700',
    lineHeight: 18,
  },
  matchContextHint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 16,
  },
  matchContextTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  matchContextFill: {
    height: '100%',
    borderRadius: 999,
  },
});
