import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import type { Movie } from '../../services/tmdb';
import { getLocalizedMediaFilterLabel } from '../../shared/i18n/helpers';
import type { ApiUser } from '../../shared/types';
import { theme } from '../../shared/theme';
import { getCompatibilityStyle } from '../../shared/theme/compatibility';
import MovieCard from './MovieCard';
import SegmentedControl from './ui/SegmentedControl';
import AccessibleModal from './ui/AccessibleModal';

interface CompatibilitySheetProps {
  visible: boolean;
  user: Pick<ApiUser, 'name'>;
  score: number;
  favorites: Movie[];
  watched: Movie[];
  onClose: () => void;
  onMovieClick?: (movie: Movie) => void;
}

export default function CompatibilitySheet({
  visible,
  user,
  score,
  favorites,
  watched,
  onClose,
  onMovieClick,
}: CompatibilitySheetProps) {
  const { t } = useLocalization();
  const [tab, setTab] = useState<'favorites' | 'watched'>('favorites');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const rawList = tab === 'favorites' ? favorites : watched;
  const compatibilityStyle = getCompatibilityStyle(score);

  const list = rawList.filter((movie) => {
    if (mediaFilter === 'movie') {
      return movie.media_type === 'movie' || Boolean(movie.title);
    }

    if (mediaFilter === 'tv') {
      return movie.media_type === 'tv' || Boolean(movie.name);
    }

    return true;
  });

  return (
    <AccessibleModal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />

        <SafeAreaView edges={['right', 'bottom', 'left']} style={styles.sheet}>
          <View style={styles.handle} />

          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.closeButton}>
            <MaterialCommunityIcons name="chevron-down" size={22} color={theme.colors.textMuted} />
          </Pressable>

          <View style={styles.header}>
            <Text style={styles.kicker}>{t('compatibility.sheet.kicker', { name: user.name })}</Text>

            <View style={styles.scoreRow}>
              <View style={[styles.progressTrack, { backgroundColor: compatibilityStyle.track }]}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(score, 100)}%`, backgroundColor: compatibilityStyle.color },
                  ]}
                />
              </View>

              <Text style={[styles.score, { color: compatibilityStyle.color }]}>%{score}</Text>
            </View>
          </View>

          <View style={styles.controls}>
            <SegmentedControl
              value={tab}
              onChange={setTab}
              options={[
                { label: t('match.context.sharedFavorites', { count: favorites.length }), value: 'favorites' },
                { label: t('match.context.sharedWatched', { count: watched.length }), value: 'watched' },
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
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {list.length === 0 ? (
              <Text style={styles.empty}>
                {tab === 'favorites' ? t('compatibility.sheet.emptyFavorites') : t('compatibility.sheet.emptyWatched')}
              </Text>
            ) : (
              <View style={styles.grid}>
                {list.map((movie) => (
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
    maxHeight: '78%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: theme.colors.backgroundElevated,
    paddingTop: 8,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: theme.radius.pill,
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
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 5,
  },
  kicker: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontFamily: theme.fonts.semibold,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 7,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceStrong,
  },
  progressFill: {
    height: '100%',
    borderRadius: theme.radius.pill,
  },
  score: {
    fontSize: 20,
    fontFamily: theme.fonts.extraBold,
  },
  controls: {
    paddingHorizontal: 12,
    gap: 6,
  },
  content: {
    padding: 16,
    paddingBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  empty: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
    textAlign: 'center',
    paddingVertical: 20,
  },
});
