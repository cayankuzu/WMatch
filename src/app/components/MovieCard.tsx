import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Movie } from '../../services/tmdb';
import type { ViewerPreview } from '../../shared/types';
import { tmdbService } from '../../services/tmdb';
import { telemetry } from '../../services/telemetry';
import { theme } from '../../shared/theme';
import ViewerCount from './ViewerCount';

interface MovieCardProps {
  movie: Movie;
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
  showViewers?: boolean;
  viewerCount?: number;
  viewerProfiles?: ViewerPreview[];
}

const sizeMap = {
  small: { width: 98, posterHeight: 146 },
  medium: { width: 124, posterHeight: 184 },
  large: { width: 154, posterHeight: 228 },
};
let firstMediaDisplayed = false;

function markFirstMediaDisplay() {
  if (firstMediaDisplayed) {
    return;
  }

  firstMediaDisplayed = true;
  telemetry.markStartupMilestone('first_media_display');
}

function MovieCard({
  movie,
  size = 'medium',
  onClick,
  showViewers = false,
  viewerCount = 0,
  viewerProfiles = [],
}: MovieCardProps) {
  const title = movie.title || movie.name || 'İsimsiz içerik';
  const year = movie.release_date?.slice(0, 4) || movie.first_air_date?.slice(0, 4);
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : null;
  const dimensions = sizeMap[size];
  const posterSize = size === 'large' ? 'w500' : 'w200';
  const posterUri = tmdbService.getPosterUrl(movie.poster_path, posterSize);
  const mediaType = movie.media_type === 'tv' ? 'Dizi' : 'Film';
  const accessibilityParts = [title, mediaType, year, rating ? `${rating} puan` : null].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityParts.join(', ')}
      disabled={!onClick}
      onPress={onClick}
      onPressIn={() =>
        void tmdbService.prefetchMovieArtwork([movie], {
          includeBackdrop: true,
          posterSize,
          backdropSize: 'w500',
          priority: 'intent',
        })
      }
      style={[styles.wrapper, { width: dimensions.width }]}
    >
      <Image
        accessible={false}
        cachePolicy="memory-disk"
        contentFit="cover"
        onDisplay={markFirstMediaDisplay}
        priority="normal"
        recyclingKey={`${movie.media_type ?? 'movie'}:${movie.id}`}
        source={{ uri: posterUri }}
        style={[styles.poster, { height: dimensions.posterHeight }]}
        transition={120}
      />
      <View style={styles.meta}>
        <Text numberOfLines={2} style={styles.title}>
          {title}
        </Text>
        <View style={styles.details}>
          {year ? <Text style={styles.detailText}>{year}</Text> : null}
          {rating ? (
            <View style={styles.rating}>
              <MaterialCommunityIcons accessible={false} name="star" size={12} color={theme.colors.star} />
              <Text style={styles.ratingText}>{rating}</Text>
            </View>
          ) : null}
        </View>
        {showViewers && viewerCount > 0 ? (
          <ViewerCount totalCount={viewerCount} viewerProfiles={viewerProfiles} />
        ) : null}
      </View>
    </Pressable>
  );
}

export default memo(MovieCard);

const styles = StyleSheet.create({
  wrapper: {
    gap: 7,
  },
  poster: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
  },
  meta: {
    gap: 4,
  },
  title: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '600',
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: theme.colors.star,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
});
