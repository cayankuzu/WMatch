import { useEffect, useMemo, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import type { Movie } from '../../services/tmdb';
import { tmdbService } from '../../services/tmdb';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import { theme } from '../../shared/theme';
import { getServerNowMs } from '../../shared/utils/serverTime';
import { triggerHaptic } from '../../services/haptics';
import AppImage from './ui/AppImage';

const WATCH_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

interface CurrentMovieBarProps {
  movie: Movie | null;
  showEmptyState?: boolean;
  isActive: boolean;
  watchingUpdatedAt?: string | null;
  onMovieClick?: () => void;
  onPauseWatching?: () => void;
  onResumeWatching?: () => void;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function CurrentMovieBar({
  movie,
  showEmptyState = true,
  isActive,
  watchingUpdatedAt = null,
  onMovieClick,
  onPauseWatching,
  onResumeWatching,
}: CurrentMovieBarProps) {
  const { t } = useLocalization();
  const [tick, setTick] = useState(getServerNowMs());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTick(getServerNowMs());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  const remainingWatchMs = useMemo(() => {
    if (!watchingUpdatedAt || !isActive) {
      return WATCH_SESSION_DURATION_MS;
    }

    const startedAt = new Date(watchingUpdatedAt).getTime();

    if (!Number.isFinite(startedAt)) {
      return WATCH_SESSION_DURATION_MS;
    }

    return Math.max(0, startedAt + WATCH_SESSION_DURATION_MS - tick);
  }, [isActive, tick, watchingUpdatedAt]);

  if (!movie && !showEmptyState) {
    return null;
  }

  if (!movie) {
    return (
      <View style={styles.safeArea}>
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons name="movie-open-outline" size={16} color={theme.colors.primarySoft} />
          </View>
          <View style={styles.emptyTextWrap}>
            <Text style={styles.emptyTitle}>{t('watch.current.empty.title')}</Text>
            <Text style={styles.emptyDescription}>{t('watch.current.empty.description')}</Text>
          </View>
        </View>
      </View>
    );
  }

  const title = movie.title || movie.name || t('watch.current.untitled');
  const year = movie.release_date?.slice(0, 4) || movie.first_air_date?.slice(0, 4);
  const rating = movie.vote_average ? movie.vote_average.toFixed(1) : null;
  const countdownLabel = isActive ? formatDuration(remainingWatchMs) : t('watch.current.paused');

  return (
    <View style={styles.safeArea}>
      <View style={styles.container}>
        <Pressable
          accessible={false}
          hitSlop={6}
          onPress={onMovieClick}
          style={({ pressed }) => [styles.posterButton, pressed && styles.pressed]}
        >
          <AppImage
            contentFit="cover"
            priority="high"
            recyclingKey={`${movie.media_type ?? 'movie'}:${movie.id}`}
            uri={tmdbService.getPosterUrl(movie.poster_path, 'w200')}
            style={styles.poster}
            transition={theme.motion.fast}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${isActive ? t('watch.current.active') : t('watch.current.paused')}. ${countdownLabel}`}
          disabled={!onMovieClick}
          onPress={onMovieClick}
          style={styles.info}
        >
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, !isActive && styles.statusDotPaused]} />
            <Text style={styles.statusLabel}>{isActive ? t('watch.current.active') : t('watch.current.paused')}</Text>
          </View>

          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>

          <View style={styles.meta}>
            {year ? <Text style={styles.metaText}>{year}</Text> : null}
            {rating ? (
              <View style={styles.ratingRow}>
                <MaterialCommunityIcons name="star" size={12} color={theme.colors.star} />
                <Text style={styles.ratingText}>{rating}</Text>
              </View>
            ) : null}
            <View style={[styles.timerChip, !isActive && styles.timerChipPaused]}>
              <MaterialCommunityIcons
                name={isActive ? 'timer-outline' : 'pause-circle-outline'}
                size={12}
                color={isActive ? theme.colors.primarySoft : theme.colors.textMuted}
              />
              <Text style={[styles.timerText, !isActive && styles.timerTextPaused]}>{countdownLabel}</Text>
            </View>
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isActive ? t('watch.current.pause') : t('watch.current.resume')}
          accessibilityState={{ disabled: !(isActive ? onPauseWatching : onResumeWatching) }}
          disabled={!(isActive ? onPauseWatching : onResumeWatching)}
          onPress={() => {
            triggerHaptic('selection');
            (isActive ? onPauseWatching : onResumeWatching)?.();
          }}
          style={({ pressed }) => [
            styles.action,
            !isActive && styles.resumeAction,
            pressed && styles.pressed,
          ]}
        >
          <MaterialCommunityIcons
            name={isActive ? 'pause-circle-outline' : 'play-circle-outline'}
            size={15}
            color={theme.colors.white}
          />
          <Text style={styles.actionLabel}>{isActive ? t('watch.current.pause') : t('watch.current.resume')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: theme.colors.glass,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  container: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingVertical: 6,
  },
  emptyState: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingVertical: 8,
  },
  emptyIcon: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  emptyTextWrap: {
    flex: 1,
    gap: 3,
  },
  emptyTitle: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  emptyDescription: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  posterButton: {
    borderRadius: theme.radius.control,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  poster: {
    width: 36,
    height: 48,
    backgroundColor: theme.colors.surface,
  },
  info: {
    flex: 1,
    gap: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primarySoft,
  },
  statusDotPaused: {
    backgroundColor: theme.colors.textSoft,
  },
  statusLabel: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.micro,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  metaText: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: theme.colors.star,
    ...theme.typography.roles.meta,
  },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  timerChipPaused: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  timerText: {
    color: theme.colors.primarySoft,
    ...theme.typography.roles.micro,
    fontVariant: ['tabular-nums'],
  },
  timerTextPaused: {
    color: theme.colors.textMuted,
  },
  action: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.control,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  resumeAction: {
    backgroundColor: theme.colors.primary,
  },
  actionLabel: {
    color: theme.colors.white,
    ...theme.typography.roles.micro,
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
});
