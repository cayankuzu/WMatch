import { memo, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import type { Movie } from '../../../services/tmdb';
import { getLocalizedMediaFilterLabel } from '../../../shared/i18n/helpers';
import { theme } from '../../../shared/theme';
import { getFixedGridItemWidth } from '../../../shared/utils/grid';
import MovieCard from '../MovieCard';
import DataState from '../ui/DataState';
import OptionChips from '../ui/OptionChips';
import SegmentedControl from '../ui/SegmentedControl';

interface ProfileMediaLibraryProps {
  fallbackWidth: number;
  favorites: Movie[];
  isOwnProfile: boolean;
  loading: boolean;
  watched: Movie[];
  onMovieClick?: (movie: Movie) => void;
}

function ProfileMediaLibrary({
  fallbackWidth,
  favorites,
  isOwnProfile,
  loading,
  watched,
  onMovieClick,
}: ProfileMediaLibraryProps) {
  const { t } = useLocalization();
  const [selectedTab, setSelectedTab] = useState<'favorites' | 'watched'>('favorites');
  const [contentFilter, setContentFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [gridWidth, setGridWidth] = useState(0);
  const availableWidth = gridWidth || fallbackWidth;
  const columns = availableWidth < 350 ? 2 : 3;
  const movieWidth = getFixedGridItemWidth(availableWidth, columns, theme.layout.cardGap);
  const movies = useMemo(() => {
    const source = selectedTab === 'favorites' ? favorites : watched;
    return source.filter((item) => {
      if (contentFilter === 'movie') return item.media_type === 'movie' || Boolean(item.title);
      if (contentFilter === 'tv') return item.media_type === 'tv' || Boolean(item.name);
      return true;
    });
  }, [contentFilter, favorites, selectedTab, watched]);
  const emptyText = selectedTab === 'favorites'
    ? t(isOwnProfile ? 'profile.card.empty.favorites.own' : 'profile.card.empty.favorites.other')
    : t(isOwnProfile ? 'profile.card.empty.watched.own' : 'profile.card.empty.watched.other');

  if (loading) {
    return <DataState state="initial-loading" title={t('profile.loading')} />;
  }

  const handleLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setGridWidth((current) => Math.abs(current - nextWidth) < 0.5 ? current : nextWidth);
  };

  return (
    <>
      <SegmentedControl
        size="compact"
        value={selectedTab}
        onChange={setSelectedTab}
        options={[
          { label: t('profile.card.segment.favorites', { count: favorites.length }), value: 'favorites' },
          { label: t('profile.card.segment.watched', { count: watched.length }), value: 'watched' },
        ]}
      />
      <OptionChips
        value={contentFilter}
        onChange={setContentFilter}
        options={[
          { label: getLocalizedMediaFilterLabel(t, 'all'), value: 'all' },
          { label: getLocalizedMediaFilterLabel(t, 'movie'), value: 'movie' },
          { label: getLocalizedMediaFilterLabel(t, 'tv'), value: 'tv' },
        ]}
      />
      {movies.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>{emptyText}</Text></View>
      ) : (
        <View onLayout={handleLayout} style={styles.grid}>
          {movies.map((movie) => (
            <MovieCard
              key={`${movie.id}-${movie.media_type ?? 'media'}`}
              movie={movie}
              size="small"
              width={movieWidth}
              onClick={() => onMovieClick?.(movie)}
            />
          ))}
        </View>
      )}
    </>
  );
}

export default memo(ProfileMediaLibrary);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.layout.cardGap },
  empty: {
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 12,
  },
  emptyText: { color: theme.colors.textMuted, fontSize: theme.typography.body, textAlign: 'center' },
});
