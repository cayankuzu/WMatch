import { useEffect, useMemo, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { tmdbService, type Movie } from '../../services/tmdb';
import { getLocalizedMediaFilterLabel } from '../../shared/i18n/helpers';
import type { MatchContextSnapshot } from '../../shared/types';
import { theme } from '../../shared/theme';
import { getCompatibilityStyle } from '../../shared/theme/compatibility';
import MovieCard from './MovieCard';
import SegmentedControl from './ui/SegmentedControl';
import AccessibleModal from './ui/AccessibleModal';

interface MatchContextSheetProps {
  visible: boolean;
  context: MatchContextSnapshot;
  currentUserId: string;
  otherUserName: string;
  onClose: () => void;
  onMovieClick?: (movie: Movie) => void;
}

function getDateLocale(locale: 'tr' | 'en') {
  return locale === 'tr' ? 'tr-TR' : 'en-US';
}

export default function MatchContextSheet({
  visible,
  context,
  currentUserId,
  otherUserName,
  onClose,
  onMovieClick,
}: MatchContextSheetProps) {
  const { locale, t } = useLocalization();
  const [matchedMovie, setMatchedMovie] = useState<Movie | null>(null);
  const [commonFavorites, setCommonFavorites] = useState<Movie[]>([]);
  const [commonWatched, setCommonWatched] = useState<Movie[]>([]);
  const [tab, setTab] = useState<'favorites' | 'watched'>('favorites');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [mediaLoadFailed, setMediaLoadFailed] = useState(false);
  const [mediaLoadAttempt, setMediaLoadAttempt] = useState(0);
  const compatibilityStyle = getCompatibilityStyle(context.compatibilityScore ?? 0);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;
    setMediaLoadFailed(false);

    async function hydrateContextMovies() {
      try {
        const [movie, favoriteMovies, watchedMovies] = await Promise.all([
          context.matchedMovieId ? tmdbService.getMediaById(context.matchedMovieId) : Promise.resolve(null),
          context.commonFavoriteMovieIds.length > 0
            ? tmdbService.getMediaListByIds(context.commonFavoriteMovieIds)
            : Promise.resolve([]),
          context.commonWatchedMovieIds.length > 0
            ? tmdbService.getMediaListByIds(context.commonWatchedMovieIds)
            : Promise.resolve([]),
        ]);

        if (cancelled) {
          return;
        }

        setMatchedMovie(movie);
        setCommonFavorites(favoriteMovies);
        setCommonWatched(watchedMovies);
      } catch {
        if (!cancelled) {
          setMediaLoadFailed(true);
        }
      }
    }

    void hydrateContextMovies();

    return () => {
      cancelled = true;
    };
  }, [context, mediaLoadAttempt, visible]);

  const getUserLabel = (userId: string | null) => {
    if (!userId) {
      return t('match.context.user.unknown');
    }

    return userId === currentUserId ? t('match.context.user.self') : otherUserName;
  };

  const getMatchTypeLabel = (type: MatchContextSnapshot['type']) => {
    if (type === 'compatibility') {
      return t('profile.viewer.matchType.compatibility');
    }

    if (type === 'watch') {
      return t('profile.viewer.matchType.watch');
    }

    return t('profile.viewer.matchType.like');
  };

  const getMatchSourceLabel = (type: MatchContextSnapshot['type']) => {
    if (type === 'compatibility') {
      return t('match.context.source.compatibility');
    }

    if (type === 'watch') {
      return t('match.context.source.watch');
    }

    return t('match.context.source.like');
  };

  const formatMatchDate = (dateLike: string) => {
    const date = new Date(dateLike);

    if (Number.isNaN(date.getTime())) {
      return t('match.context.dateMissing');
    }

    return date.toLocaleString(getDateLocale(locale), {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const rawList = tab === 'favorites' ? commonFavorites : commonWatched;
  const filteredList = useMemo(
    () =>
      rawList.filter((movie) => {
        if (mediaFilter === 'movie') {
          return movie.media_type === 'movie' || Boolean(movie.title);
        }

        if (mediaFilter === 'tv') {
          return movie.media_type === 'tv' || Boolean(movie.name);
        }

        return true;
      }),
    [mediaFilter, rawList],
  );

  const detailCards = useMemo(
    () => [
      {
        key: 'type',
        icon: 'cards-heart-outline',
        label: t('match.context.label.type'),
        value: getMatchTypeLabel(context.type),
        color: theme.colors.primarySoft,
      },
      {
        key: 'source',
        icon: 'source-branch',
        label: t('match.context.label.source'),
        value: getMatchSourceLabel(context.type),
        color: theme.colors.info,
      },
      {
        key: 'first-like',
        icon: 'heart-outline',
        label: t('match.context.label.firstLike'),
        value: getUserLabel(context.firstLikeByUserId),
        color: theme.colors.dangerText,
      },
      {
        key: 'accepted-by',
        icon: 'check-decagram-outline',
        label: t('match.context.label.acceptedBy'),
        value: getUserLabel(context.acceptedByUserId),
        color: theme.colors.warning,
      },
      {
        key: 'content',
        icon: 'movie-open-star-outline',
        label: t('match.context.label.movie'),
        value: matchedMovie?.title || matchedMovie?.name || t('match.context.missing'),
        color: theme.colors.primarySoft,
      },
      {
        key: 'created-at',
        icon: 'calendar-clock-outline',
        label: t('match.context.label.createdAt'),
        value: formatMatchDate(context.createdAt),
        color: theme.colors.text,
      },
    ],
    [
      context.acceptedByUserId,
      context.createdAt,
      context.firstLikeByUserId,
      context.type,
      matchedMovie?.name,
      matchedMovie?.title,
      otherUserName,
      t,
    ],
  );

  return (
    <AccessibleModal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />

        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />

          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.closeButton}>
            <MaterialCommunityIcons name="chevron-down" size={22} color={theme.colors.textMuted} />
          </Pressable>

          <View style={styles.header}>
            <Text style={styles.kicker}>{getMatchTypeLabel(context.type)}</Text>
            <Text style={styles.title}>{t('match.context.title', { name: otherUserName })}</Text>
            <Text style={styles.subtitle}>{t('match.context.subtitle')}</Text>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {mediaLoadFailed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('data.error.title')}. ${t('data.action.retry')}`}
                onPress={() => setMediaLoadAttempt((current) => current + 1)}
                style={styles.mediaFailureCard}
              >
                <MaterialCommunityIcons name="cloud-alert-outline" size={18} color={theme.colors.dangerText} />
                <Text accessibilityRole="alert" style={styles.mediaFailureText}>{t('data.error.title')}</Text>
                <Text style={styles.mediaFailureAction}>{t('data.action.retry')}</Text>
              </Pressable>
            ) : null}
            <View style={styles.scoreCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('match.context.scoreTitle')}</Text>
                <Text style={[styles.scoreValue, { color: compatibilityStyle.color }]}>
                  {context.compatibilityScore != null ? `%${context.compatibilityScore}` : t('match.context.scoreMissing')}
                </Text>
              </View>
              {context.compatibilityScore != null ? (
                <>
                  <View style={[styles.progressTrack, { backgroundColor: compatibilityStyle.track }]}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${Math.min(context.compatibilityScore, 100)}%`,
                          backgroundColor: compatibilityStyle.color,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.scoreHint}>{t('match.context.scoreHint')}</Text>
                </>
              ) : (
                <Text style={styles.mutedText}>{t('match.context.scoreEmpty')}</Text>
              )}
            </View>

            <View style={styles.infoGrid}>
              {detailCards.map((item) => (
                <View key={item.key} style={styles.infoCard}>
                  <MaterialCommunityIcons name={item.icon as never} size={18} color={item.color} />
                  <Text style={styles.infoLabel}>{item.label}</Text>
                  <Text style={styles.infoValue}>{item.value}</Text>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('match.context.matchedContentTitle')}</Text>
              {matchedMovie ? (
                <View style={styles.grid}>
                  <MovieCard
                    movie={matchedMovie}
                    size="small"
                    onClick={() => {
                      onMovieClick?.(matchedMovie);
                      onClose();
                    }}
                  />
                </View>
              ) : (
                <View style={styles.mutedCard}>
                  <Text style={styles.mutedText}>{t('match.context.matchedContentEmpty')}</Text>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('match.context.sharedContentTitle')}</Text>
                <Text style={styles.sectionCount}>
                  {t('match.context.sharedContentCount', {
                    count: tab === 'favorites' ? commonFavorites.length : commonWatched.length,
                  })}
                </Text>
              </View>

              <SegmentedControl
                value={tab}
                onChange={setTab}
                options={[
                  { label: t('match.context.sharedFavorites', { count: commonFavorites.length }), value: 'favorites' },
                  { label: t('match.context.sharedWatched', { count: commonWatched.length }), value: 'watched' },
                ]}
              />

              <SegmentedControl
                value={mediaFilter}
                onChange={setMediaFilter}
                options={[
                  { label: getLocalizedMediaFilterLabel(t, 'all'), value: 'all' },
                  { label: getLocalizedMediaFilterLabel(t, 'movie'), value: 'movie' },
                  { label: getLocalizedMediaFilterLabel(t, 'tv'), value: 'tv' },
                ]}
              />

              {filteredList.length === 0 ? (
                <View style={styles.mutedCard}>
                  <Text style={styles.mutedText}>
                    {tab === 'favorites' ? t('match.context.sharedFavoritesEmpty') : t('match.context.sharedWatchedEmpty')}
                  </Text>
                </View>
              ) : (
                <View style={styles.grid}>
                  {filteredList.map((movie) => (
                    <MovieCard
                      key={`${movie.id}-${movie.media_type ?? 'media'}`}
                      movie={movie}
                      size="small"
                      onClick={() => {
                        onMovieClick?.(movie);
                        onClose();
                      }}
                    />
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.scrim,
  },
  sheet: {
    maxHeight: '84%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: theme.colors.backgroundElevated,
    paddingTop: 10,
  },
  mediaFailureCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.dangerSurface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mediaFailureText: {
    flex: 1,
    color: theme.colors.dangerText,
    fontSize: theme.typography.caption,
    fontWeight: '800',
  },
  mediaFailureAction: {
    color: theme.colors.text,
    fontSize: theme.typography.caption,
    fontWeight: '800',
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: theme.colors.borderStrong,
    marginBottom: 8,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  kicker: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  content: {
    padding: 16,
    paddingBottom: 22,
    gap: 14,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  sectionCount: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  scoreCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 14,
    gap: 9,
  },
  scoreValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  scoreHint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  infoCard: {
    width: '47%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 5,
  },
  infoLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  infoValue: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  mutedCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 14,
  },
  mutedText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
