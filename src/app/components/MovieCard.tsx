import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Movie } from '../../services/tmdb';
import type { ViewerPreview } from '../../shared/types';
import { tmdbService } from '../../services/tmdb';
import { telemetry } from '../../services/telemetry';
import { theme } from '../../shared/theme';
import ViewerCount from './ViewerCount';
import AppImage from './ui/AppImage';
import { useLocalization } from '../../context/LocalizationContext';

interface MovieCardProps {
  movie: Movie;
  size?: 'small' | 'medium' | 'large';
  onClick?: () => void;
  showViewers?: boolean;
  viewerCount?: number;
  viewerProfiles?: ViewerPreview[];
  imagePriority?: 'low' | 'normal' | 'high';
  width?: number;
}

const sizeMap = {
  small: { width: 88, posterHeight: 131 },
  medium: { width: 112, posterHeight: 167 },
  large: { width: 140, posterHeight: 209 },
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
  imagePriority = 'normal',
  width,
}: MovieCardProps) {
  const { t } = useLocalization();
  const title = movie.title || movie.name || t('movie.detail.untitled');
  const year = movie.release_date?.slice(0, 4) || movie.first_air_date?.slice(0, 4);
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : null;
  const dimensions = sizeMap[size];
  const resolvedWidth = width ?? dimensions.width;
  const resolvedPosterHeight = width ? Math.round(width * 1.49) : dimensions.posterHeight;
  const posterSize = size === 'large' ? 'w500' : 'w200';
  const posterUri = tmdbService.getPosterUrl(movie.poster_path, posterSize);
  const mediaType = movie.media_type === 'tv' ? t('movie.detail.media.series') : t('movie.detail.media.movie');
  const accessibilityParts = [title, mediaType, year, rating].filter(Boolean);

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
      style={({ pressed }) => [
        styles.wrapper,
        { width: resolvedWidth },
        pressed && styles.wrapperPressed,
      ]}
    >
      <AppImage
        contentFit="cover"
        onDisplay={markFirstMediaDisplay}
        priority={imagePriority}
        recyclingKey={`${movie.media_type ?? 'movie'}:${movie.id}`}
        uri={posterUri}
        style={[styles.poster, { height: resolvedPosterHeight }]}
        transition={theme.motion.fast}
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
    gap: 5,
  },
  wrapperPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  poster: {
    width: '100%',
    borderRadius: theme.radius.poster,
    backgroundColor: theme.colors.surface,
  },
  meta: {
    gap: 3,
  },
  title: {
    color: theme.colors.text,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailText: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.micro,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: theme.colors.star,
    ...theme.typography.roles.micro,
  },
});
