import { memo, useCallback, useMemo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { getMovieKey, type Movie } from '../../services/tmdb';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import type { ViewerPreview } from '../../shared/types';
import { theme } from '../../shared/theme';
import MovieCard from './MovieCard';
import { SkeletonBlock } from './ui/Skeleton';

interface MovieRowProps {
  title: string;
  movies: Movie[];
  size?: 'small' | 'medium' | 'large';
  onLoadMore?: () => void;
  onMovieClick?: (movie: Movie) => void;
  showViewerCount?: boolean;
  viewerCounts?: Record<string, number>;
  viewerProfiles?: Record<string, ViewerPreview[]>;
  icon?: 'eye' | 'film' | 'tv';
  emptyMessage?: string;
  loading?: boolean;
}

const iconMap = {
  eye: 'eye-outline',
  film: 'movie-open-outline',
  tv: 'television-play',
} as const;

function MovieRow({
  title,
  movies,
  size = 'medium',
  onLoadMore,
  onMovieClick,
  showViewerCount = false,
  viewerCounts,
  viewerProfiles,
  icon,
  emptyMessage,
  loading = false,
}: MovieRowProps) {
  const uniqueMovies = useMemo(
    () =>
      movies.filter(
        (movie, index, list) =>
          index ===
          list.findIndex((candidate) => getMovieKey(candidate) === getMovieKey(movie)),
      ),
    [movies],
  );

  const renderMovie = useCallback(
    ({ item }: { item: Movie }) => (
      <MovieCard
        movie={item}
        size={size}
        onClick={() => onMovieClick?.(item)}
        showViewers={showViewerCount}
        viewerCount={showViewerCount ? viewerCounts?.[getMovieKey(item)] ?? 0 : 0}
        viewerProfiles={showViewerCount ? viewerProfiles?.[getMovieKey(item)] ?? [] : []}
      />
    ),
    [onMovieClick, showViewerCount, size, viewerCounts, viewerProfiles],
  );

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {icon ? (
            <MaterialCommunityIcons name={iconMap[icon]} size={16} color={theme.colors.primarySoft} />
          ) : null}
          <Text style={styles.title}>{title}</Text>
        </View>
      </View>

      {loading && uniqueMovies.length === 0 ? (
        <View accessible accessibilityLabel={title} accessibilityState={{ busy: true }} style={styles.skeletonList}>
          {Array.from({ length: 4 }, (_, index) => (
            <View key={index} style={styles.skeletonCard}>
              <SkeletonBlock style={styles.skeletonPoster} />
              <SkeletonBlock style={styles.skeletonTitle} />
              <SkeletonBlock style={styles.skeletonMeta} />
            </View>
          ))}
        </View>
      ) : uniqueMovies.length === 0 && emptyMessage ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <FlatList
          horizontal
          data={uniqueMovies}
          keyExtractor={getMovieKey}
          contentContainerStyle={styles.list}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.6}
          renderItem={renderMovie}
        />
      )}
    </View>
  );
}

export default memo(MovieRow);

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SCREEN_SIDE_SPACING,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontWeight: '800',
  },
  emptyState: {
    marginHorizontal: SCREEN_SIDE_SPACING,
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    gap: 10,
  },
  skeletonList: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    overflow: 'hidden',
  },
  skeletonCard: {
    width: 98,
    gap: 7,
  },
  skeletonPoster: {
    width: 98,
    height: 146,
    borderRadius: 16,
  },
  skeletonTitle: {
    width: 82,
    height: 12,
    borderRadius: 6,
  },
  skeletonMeta: {
    width: 52,
    height: 9,
    borderRadius: 5,
  },
});
