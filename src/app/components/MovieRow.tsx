import { memo, useCallback, useMemo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { getMovieKey, type Movie } from '../../services/tmdb';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import type { ViewerPreview } from '../../shared/types';
import { theme } from '../../shared/theme';
import MovieCard, { getMovieCardWidth } from './MovieCard';
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
  const itemLength = getMovieCardWidth(size) + 8;
  const uniqueMovies = useMemo(
    () => {
      const seenMovieKeys = new Set<string>();
      return movies.filter((movie) => {
        const movieKey = getMovieKey(movie);
        if (seenMovieKeys.has(movieKey)) {
          return false;
        }

        seenMovieKeys.add(movieKey);
        return true;
      });
    },
    [movies],
  );

  const renderMovie = useCallback(
    ({ item, index }: { item: Movie; index: number }) => (
      <MovieCard
        movie={item}
        size={size}
        onClick={() => onMovieClick?.(item)}
        showViewers={showViewerCount}
        viewerCount={showViewerCount ? viewerCounts?.[getMovieKey(item)] ?? 0 : 0}
        viewerProfiles={showViewerCount ? viewerProfiles?.[getMovieKey(item)] ?? [] : []}
        imagePriority={index < 2 ? 'high' : 'normal'}
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
          getItemLayout={(_, index) => ({
            index,
            length: itemLength,
            offset: itemLength * index,
          })}
          contentContainerStyle={styles.list}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={3}
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
    gap: 8,
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
    ...theme.typography.roles.sectionTitle,
  },
  emptyState: {
    marginHorizontal: SCREEN_SIDE_SPACING,
    minHeight: 44,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  emptyText: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    gap: 8,
  },
  skeletonList: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    overflow: 'hidden',
  },
  skeletonCard: {
    width: 88,
    gap: 5,
  },
  skeletonPoster: {
    width: 88,
    height: 131,
    borderRadius: theme.radius.poster,
  },
  skeletonTitle: {
    width: 82,
    height: 12,
    borderRadius: theme.radius.xs,
  },
  skeletonMeta: {
    width: 52,
    height: 9,
    borderRadius: 5,
  },
});
