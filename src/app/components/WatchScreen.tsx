import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import type { Movie } from '../../services/tmdb';
import { SCREEN_BOTTOM_SPACING } from '../../shared/constants';
import type { ViewerPreview } from '../../shared/types';
import { theme } from '../../shared/theme';
import { telemetry } from '../../services/telemetry';
import EmptyState from './EmptyState';
import MovieRow from './MovieRow';
import SearchBar from './SearchBar';
import DataState from './ui/DataState';
import DataWarningBanner from './ui/DataWarningBanner';
import AppRefreshControl from './ui/AppRefreshControl';

interface WatchScreenProps {
  isSearching: boolean;
  searchQuery: string;
  searchResults: Movie[];
  popularMoviesLoading: boolean;
  popularTVLoading: boolean;
  homeError: string | null;
  liveNowError: string | null;
  liveNowLoading: boolean;
  searchLoading: boolean;
  searchError: string | null;
  liveNowMovies: Movie[];
  popularMovies: Movie[];
  popularTVShows: Movie[];
  viewerCounts: Record<string, number>;
  viewerProfiles: Record<string, ViewerPreview[]>;
  refreshing: boolean;
  onRefresh: () => void;
  onMovieClick: (movie: Movie) => void;
  onSearch: (query: string, filter: 'all' | 'movie' | 'tv') => void;
  onSearchStateChange: (value: boolean) => void;
  onLoadMoreLiveNow?: () => void;
  onLoadMoreMovies: () => void;
  onLoadMoreTVShows: () => void;
}

export default function WatchScreen({
  isSearching,
  searchQuery,
  searchResults,
  popularMoviesLoading,
  popularTVLoading,
  homeError,
  liveNowError,
  liveNowLoading,
  searchLoading,
  searchError,
  liveNowMovies,
  popularMovies,
  popularTVShows,
  viewerCounts,
  viewerProfiles,
  refreshing,
  onRefresh,
  onMovieClick,
  onSearch,
  onSearchStateChange,
  onLoadMoreLiveNow,
  onLoadMoreMovies,
  onLoadMoreTVShows,
}: WatchScreenProps) {
  const { t } = useLocalization();
  const hasHomeContent = liveNowMovies.length > 0 || popularMovies.length > 0 || popularTVShows.length > 0;
  const hasActiveSearch = isSearching && searchQuery.trim().length > 0;

  useEffect(() => {
    if (hasHomeContent) {
      telemetry.markStartupMilestone('watch_content_ready', {
        liveNowCount: liveNowMovies.length,
        movieCount: popularMovies.length,
        tvCount: popularTVShows.length,
      });
    }
  }, [hasHomeContent, liveNowMovies.length, popularMovies.length, popularTVShows.length]);

  return (
    <SafeAreaView
      edges={[]}
      style={styles.safeArea}
    >
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.sections}>
          {homeError && hasHomeContent ? (
            <DataWarningBanner
              title={t('data.stale.title')}
              description={t('data.stale.description')}
              actionLabel={t('data.action.retry')}
              onAction={onRefresh}
            />
          ) : null}

          {liveNowError ? (
            <DataWarningBanner
              title={t('data.error.title')}
              description={liveNowError}
              actionLabel={t('data.action.retry')}
              onAction={onRefresh}
            />
          ) : null}

          {homeError && !hasHomeContent ? (
            <DataState
              state="fatal-error"
              title={t('data.error.title')}
              description={homeError}
              actionLabel={t('data.action.retry')}
              onAction={onRefresh}
            />
          ) : null}

          <MovieRow
            title={t('watch.screen.liveNow')}
            movies={liveNowMovies}
            size="small"
            onMovieClick={onMovieClick}
            showViewerCount
            viewerCounts={viewerCounts}
            viewerProfiles={viewerProfiles}
            icon="eye"
            emptyMessage={t('watch.screen.liveNow.empty')}
            onLoadMore={onLoadMoreLiveNow}
            loading={liveNowLoading}
          />

          <SearchBar
            onSearch={onSearch}
            onFocus={() => onSearchStateChange(true)}
            onBlur={() => onSearchStateChange(false)}
          />

          {hasActiveSearch ? (
            searchLoading ? (
              <DataState
                state="initial-loading"
                title={t('watch.screen.searchLoading.title')}
                description={t('watch.screen.searchLoading.description')}
              />
            ) : searchError ? (
              <DataState
                state="partial-error"
                title={t('data.error.title')}
                description={searchError}
              />
            ) : searchResults.length > 0 ? (
              <MovieRow
                title={t('watch.screen.searchResults')}
                movies={searchResults}
                size="small"
                onMovieClick={onMovieClick}
                icon="film"
              />
            ) : searchQuery.trim() ? (
              <EmptyState
                icon="magnify-close"
                title={t('watch.screen.searchEmpty.title')}
                description={t('watch.screen.searchEmpty.description')}
              />
            ) : null
          ) : (
            <>
              <MovieRow
                title={t('watch.screen.popularMovies')}
                movies={popularMovies}
                size="small"
                onMovieClick={onMovieClick}
                onLoadMore={onLoadMoreMovies}
                icon="film"
                loading={popularMoviesLoading}
              />
              <MovieRow
                title={t('watch.screen.popularSeries')}
                movies={popularTVShows}
                size="small"
                onMovieClick={onMovieClick}
                onLoadMore={onLoadMoreTVShows}
                icon="tv"
                loading={popularTVLoading}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingBottom: SCREEN_BOTTOM_SPACING,
  },
  scrollView: {
    flex: 1,
  },
  sections: {
    gap: 20,
    paddingTop: 14,
  },
});
