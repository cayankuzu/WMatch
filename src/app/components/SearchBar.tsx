import { useCallback, useEffect, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { MAX_SEARCH_QUERY_LENGTH, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { getLocalizedMediaFilterLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import { triggerHaptic } from '../../services/haptics';
import {
  clearRecentSearches,
  loadRecentSearches,
  saveRecentSearch,
} from '../../services/recentSearches';
import { clampSearchQuery } from '../../shared/utils/validation';
import SegmentedControl from './ui/SegmentedControl';
import RecentSearches from './RecentSearches';

interface SearchBarProps {
  userId: string;
  onSearch: (query: string, filter: 'all' | 'movie' | 'tv') => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export default function SearchBar({ userId, onSearch, onFocus, onBlur }: SearchBarProps) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const onSearchRef = useRef(onSearch);
  const lastSearchKeyRef = useRef<string | null>(null);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  const dispatchSearch = useCallback((nextQuery: string, nextFilter: 'all' | 'movie' | 'tv') => {
    const normalizedQuery = nextQuery.trim();
    const requestKey = `${nextFilter}:${normalizedQuery}`;
    if (lastSearchKeyRef.current === requestKey) {
      return;
    }

    lastSearchKeyRef.current = requestKey;
    onSearchRef.current(normalizedQuery, nextFilter);
  }, []);

  useEffect(() => {
    lastSearchKeyRef.current = null;
    let cancelled = false;
    void loadRecentSearches(userId).then((items) => {
      if (!cancelled) {
        setRecentSearches(items);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatchSearch(query, filter);
    }, 220);

    return () => clearTimeout(timer);
  }, [dispatchSearch, filter, query]);

  const handleClear = () => {
    triggerHaptic('selection');
    setQuery('');
    setExpanded(false);
    onBlur?.();
    dispatchSearch('', 'all');
    setFilter('all');
  };

  const submitSearch = (nextQuery = query) => {
    const normalizedQuery = nextQuery.trim();
    dispatchSearch(normalizedQuery, filter);
    if (normalizedQuery) {
      void saveRecentSearch(userId, normalizedQuery).then(setRecentSearches);
    }
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.searchField, focused && styles.searchFieldFocused]}>
        <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.textSoft} />
        <TextInput
          accessibilityLabel={t('watch.search.placeholder')}
          accessibilityHint={t('watch.screen.searchResults')}
          accessibilityRole="search"
          value={query}
          onChangeText={(value) => setQuery(clampSearchQuery(value))}
          placeholder={t('watch.search.placeholder')}
          placeholderTextColor={theme.colors.textSoft}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          returnKeyType="search"
          onSubmitEditing={() => submitSearch()}
          onFocus={() => {
            setFocused(true);
            setExpanded(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            if (!query.trim()) {
              setExpanded(false);
              onBlur?.();
            }
          }}
          style={styles.input}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.reset')}
            hitSlop={4}
            onPress={handleClear}
            style={({ pressed }) => [styles.clearButton, pressed && styles.clearButtonPressed]}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.textSoft} />
          </Pressable>
        ) : null}
      </View>

      {expanded ? (
        <>
          {!query.trim() ? (
            <RecentSearches
              title={t('watch.search.recent')}
              clearLabel={t('watch.search.clearRecent')}
              searches={recentSearches}
              onSelect={(recentQuery) => {
                setQuery(recentQuery);
                submitSearch(recentQuery);
              }}
              onClear={() => {
                setRecentSearches([]);
                void clearRecentSearches(userId);
              }}
            />
          ) : null}
          <SegmentedControl
            size="compact"
            value={filter}
            onChange={setFilter}
            options={[
              { label: getLocalizedMediaFilterLabel(t, 'all'), value: 'all' },
              { label: getLocalizedMediaFilterLabel(t, 'movie'), value: 'movie' },
              { label: getLocalizedMediaFilterLabel(t, 'tv'), value: 'tv' },
            ]}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 10,
    gap: 8,
  },
  searchField: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  searchFieldFocused: {
    borderColor: theme.colors.borderFocus,
    borderWidth: 2,
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.body,
    lineHeight: 20,
  },
  clearButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.iconPressedScale }],
  },
});
