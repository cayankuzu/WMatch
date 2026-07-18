import { useEffect, useMemo, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import type { Movie } from '../../services/tmdb';
import { tmdbService } from '../../services/tmdb';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import { theme } from '../../shared/theme';
import { resolveDeviceEdgeInset } from '../../shared/utils/safeArea';
import { getServerNowMs } from '../../shared/utils/serverTime';

const WATCH_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

interface CurrentMovieBarProps {
  movie: Movie | null;
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
  isActive,
  watchingUpdatedAt = null,
  onMovieClick,
  onPauseWatching,
  onResumeWatching,
}: CurrentMovieBarProps) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const [tick, setTick] = useState(getServerNowMs());
  const safeTopInset = resolveDeviceEdgeInset(insets.top);

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

  if (!movie) {
    return (
      <View style={[styles.safeArea, { paddingTop: safeTopInset }]}>
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
    <View style={[styles.safeArea, { paddingTop: safeTopInset }]}>
      <View style={styles.container}>
        <Pressable accessible={false} onPress={onMovieClick} style={styles.posterButton}>
          <Image
            accessible={false}
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={`${movie.media_type ?? 'movie'}:${movie.id}`}
            source={{ uri: tmdbService.getPosterUrl(movie.poster_path, 'w200') }}
            style={styles.poster}
            transition={120}
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

          <Text numberOfLines={2} style={styles.title}>
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
                color={isActive ? theme.colors.primarySoft : theme.colors.warning}
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
          onPress={isActive ? onPauseWatching : onResumeWatching}
          style={[styles.action, !isActive && styles.resumeAction]}
        >
          <MaterialCommunityIcons
            name={isActive ? 'stop-circle-outline' : 'play-circle-outline'}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingVertical: 8,
  },
  emptyState: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingVertical: 12,
  },
  emptyIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
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
    fontSize: 12,
    fontWeight: '800',
  },
  emptyDescription: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
  },
  posterButton: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  poster: {
    width: 58,
    height: 78,
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
    borderRadius: 999,
    backgroundColor: theme.colors.primarySoft,
  },
  statusDotPaused: {
    backgroundColor: theme.colors.warning,
  },
  statusLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.micro.fontSize,
    lineHeight: theme.typography.roles.micro.lineHeight,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.label.fontSize,
    lineHeight: theme.typography.roles.label.lineHeight,
    fontWeight: '800',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  metaText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: theme.colors.star,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  timerChipPaused: {
    backgroundColor: theme.colors.warningSurface,
  },
  timerText: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  timerTextPaused: {
    color: theme.colors.warning,
  },
  action: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  resumeAction: {
    backgroundColor: theme.colors.warning,
  },
  actionLabel: {
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '900',
  },
});
