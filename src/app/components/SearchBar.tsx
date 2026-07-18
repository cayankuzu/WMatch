import { useEffect, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { MAX_SEARCH_QUERY_LENGTH, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { getLocalizedMediaFilterLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import { clampSearchQuery } from '../../shared/utils/validation';
import SegmentedControl from './ui/SegmentedControl';

interface SearchBarProps {
  onSearch: (query: string, filter: 'all' | 'movie' | 'tv') => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export default function SearchBar({ onSearch, onFocus, onBlur }: SearchBarProps) {
  const { t } = useLocalization();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'movie' | 'tv'>('all');
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(query.trim(), filter);
    }, 350);

    return () => clearTimeout(timer);
  }, [filter, onSearch, query]);

  const handleClear = () => {
    setQuery('');
    setExpanded(false);
    onBlur?.();
    onSearch('', 'all');
    setFilter('all');
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
            onPress={handleClear}
            style={styles.clearButton}
          >
            <MaterialCommunityIcons name="close-circle" size={18} color={theme.colors.textSoft} />
          </Pressable>
        ) : null}
      </View>

      {expanded ? (
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 12,
    gap: 10,
  },
  searchField: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    gap: 8,
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
});
