import { useEffect, useMemo, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '../../context/AppContext';
import { useLocalization } from '../../context/LocalizationContext';
import { tmdbService, type Movie } from '../../services/tmdb';
import { theme } from '../../shared/theme';
import ImagePreviewModal from './ui/ImagePreviewModal';
import AppButton from './ui/AppButton';
import AccessibleModal from './ui/AccessibleModal';

interface MovieDetailModalProps {
  movie: Movie | null;
  onClose: () => void;
}

export default function MovieDetailModal({ movie, onClose }: MovieDetailModalProps) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const {
    currentlyWatching,
    activeWatching,
    watchingState,
    setCurrentlyWatching,
    pauseCurrentlyWatching,
    resumeCurrentlyWatching,
    addToFavorites,
    removeFromFavorites,
    isFavorite,
    addToWatched,
    removeFromWatched,
    isWatched,
  } = useApp();
  const [details, setDetails] = useState<Movie | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadDetails() {
      if (!movie) {
        return;
      }

      try {
        const response =
          movie.media_type === 'tv'
            ? await tmdbService.getTVDetails(movie.id)
            : await tmdbService.getMovieDetails(movie.id);

        if (mounted) {
          setDetails(response);
        }
      } catch (error) {
        console.warn('Media details could not be enriched; using the visible card snapshot:', error);
      }
    }

    if (movie) {
      void tmdbService.prefetchMovieArtwork([movie], {
        posterSize: 'w500',
      });
    }

    void loadDetails();

    return () => {
      mounted = false;
      setDetails(null);
      setShowImagePreview(false);
    };
  }, [movie?.id, movie?.media_type]);

  const activeMovie = details ?? movie;
  const genreNames = useMemo(() => activeMovie?.genres?.map((genre) => genre.name) ?? [], [activeMovie?.genres]);

  if (!movie || !activeMovie) {
    return null;
  }

  const isSeries = activeMovie.media_type === 'tv';
  const title = activeMovie.title || activeMovie.name || t('movie.detail.untitled');
  const year = activeMovie.release_date?.slice(0, 4) || activeMovie.first_air_date?.slice(0, 4);
  const rating = activeMovie.vote_average ? activeMovie.vote_average.toFixed(1) : null;
  const heroImageUri = tmdbService.getPosterUrl(activeMovie.poster_path, 'w500');
  const previewImageUri = tmdbService.getPosterUrl(activeMovie.poster_path, 'original');
  const favoriteActive = isFavorite(activeMovie);
  const watchedActive = isWatched(activeMovie);
  const watchingActive =
    activeWatching?.id === activeMovie.id && (activeWatching.media_type ?? 'movie') === (activeMovie.media_type ?? 'movie');
  const watchingPaused =
    watchingState === 'paused' &&
    currentlyWatching?.id === activeMovie.id &&
    (currentlyWatching.media_type ?? 'movie') === (activeMovie.media_type ?? 'movie');
  const summaryText = activeMovie.overview?.trim() || null;
  const topInset = Math.max(insets.top, 0);
  const bottomInset = Math.max(insets.bottom, 12);

  return (
    <>
      <AccessibleModal
        visible={Boolean(movie)}
        animationType="slide"
        statusBarTranslucent={false}
        navigationBarTranslucent={false}
        onRequestClose={onClose}
      >
        <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.container}>
          <View pointerEvents="none" style={[styles.statusBarGuard, { height: topInset }]} />
          <View style={[styles.closeLayer, { paddingTop: topInset + 10 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.white} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
          >
            <View style={[styles.heroStage, { paddingTop: topInset + 42 }]}>
              <Pressable onPress={() => setShowImagePreview(true)} style={styles.heroCard}>
                <Image
                  accessible={false}
                  cachePolicy="memory-disk"
                  contentFit="contain"
                  source={{ uri: heroImageUri }}
                  style={styles.hero}
                  transition={120}
                />
              </Pressable>
            </View>

            <View style={styles.body}>
              <Text style={styles.title}>{title}</Text>

              <View style={styles.metaRow}>
                {year ? <Text style={styles.metaText}>{year}</Text> : null}
                {rating ? (
                  <View style={styles.ratingRow}>
                    <MaterialCommunityIcons name="star" size={13} color={theme.colors.star} />
                    <Text style={styles.ratingText}>{rating}</Text>
                  </View>
                ) : null}
                <Text style={styles.metaText}>{isSeries ? t('movie.detail.media.series') : t('movie.detail.media.movie')}</Text>
              </View>

              {genreNames.length > 0 ? (
                <View style={styles.genreWrap}>
                  {genreNames.map((genre) => (
                    <View key={genre} style={styles.genreChip}>
                      <Text style={styles.genreText}>{genre}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.actions}>
                <AppButton
                  title={
                    watchingActive
                      ? t('movie.detail.action.activeWatching')
                      : watchingPaused
                        ? t('movie.detail.action.resumeWatching')
                        : t('movie.detail.action.watchNow')
                  }
                  onPress={() => {
                    if (watchingActive) {
                      pauseCurrentlyWatching();
                    } else if (watchingPaused) {
                      resumeCurrentlyWatching();
                    } else {
                      setCurrentlyWatching(activeMovie);
                    }
                    onClose();
                  }}
                  variant={watchingActive ? 'primary' : 'warning'}
                  leftIcon={
                    <MaterialCommunityIcons
                      name={watchingActive ? 'pause-circle' : 'play'}
                      size={18}
                      color={watchingActive ? theme.colors.white : theme.colors.black}
                    />
                  }
                />

                <AppButton
                  title={favoriteActive ? t('movie.detail.action.favorited') : t('movie.detail.action.addFavorite')}
                  onPress={() => (favoriteActive ? removeFromFavorites(activeMovie) : addToFavorites(activeMovie))}
                  variant={favoriteActive ? 'primary' : 'secondary'}
                  leftIcon={
                    <MaterialCommunityIcons
                      name={favoriteActive ? 'heart' : 'heart-outline'}
                      size={16}
                      color={favoriteActive ? theme.colors.white : theme.colors.text}
                    />
                  }
                />

                <AppButton
                  title={watchedActive ? t('movie.detail.action.watched') : t('movie.detail.action.addWatched')}
                  onPress={() => (watchedActive ? removeFromWatched(activeMovie) : addToWatched(activeMovie))}
                  variant={watchedActive ? 'primary' : 'secondary'}
                  leftIcon={
                    <MaterialCommunityIcons
                      name={watchedActive ? 'check-circle' : 'check-circle-outline'}
                      size={16}
                      color={watchedActive ? theme.colors.white : theme.colors.text}
                    />
                  }
                />
              </View>

              <View style={styles.summary}>
                {summaryText ? (
                  <>
                    <Text style={styles.summaryTitle}>{t('movie.detail.summaryTitle')}</Text>
                    <Text style={styles.summaryText}>{summaryText}</Text>
                  </>
                ) : (
                  <Text style={styles.summaryNotice}>
                    {isSeries ? t('movie.detail.summaryMissingSeries') : t('movie.detail.summaryMissingMovie')}
                  </Text>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </AccessibleModal>

      <ImagePreviewModal
        visible={showImagePreview}
        imageUri={previewImageUri}
        onClose={() => setShowImagePreview(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  statusBarGuard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: theme.colors.background,
  },
  closeLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    alignItems: 'flex-end',
    paddingHorizontal: 14,
  },
  closeButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: 32,
  },
  heroStage: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    alignItems: 'center',
  },
  heroCard: {
    width: '64%',
    maxWidth: 240,
    minWidth: 190,
    aspectRatio: 2 / 3,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    shadowColor: theme.colors.black,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  hero: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.surface,
  },
  body: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: theme.colors.background,
    paddingHorizontal: 16,
    paddingTop: 18,
    gap: 14,
  },
  title: {
    color: theme.colors.text,
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: theme.colors.star,
    fontSize: 12,
    fontWeight: '800',
  },
  genreWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
  },
  genreText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  actions: {
    gap: 10,
  },
  summary: {
    gap: 8,
  },
  summaryTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  summaryText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  summaryNotice: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});
