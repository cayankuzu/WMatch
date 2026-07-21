import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { triggerHaptic } from '../../services/haptics';
import { theme } from '../../shared/theme';

interface RecentSearchesProps {
  title: string;
  clearLabel: string;
  searches: string[];
  onSelect: (query: string) => void;
  onClear: () => void;
}

export default function RecentSearches({
  title,
  clearLabel,
  searches,
  onSelect,
  onClear,
}: RecentSearchesProps) {
  if (searches.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          onPress={() => {
            triggerHaptic('selection');
            onClear();
          }}
          style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
        >
          <Text style={styles.clearLabel}>{clearLabel}</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {searches.map((query) => (
          <Pressable
            key={query}
            accessibilityRole="button"
            accessibilityLabel={query}
            onPress={() => {
              triggerHaptic('selection');
              onSelect(query);
            }}
            style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons
              accessible={false}
              color={theme.colors.textSoft}
              name="history"
              size={theme.icon.xs}
            />
            <Text numberOfLines={1} style={styles.chipLabel}>{query}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.sm,
  },
  header: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  clearButton: {
    minHeight: theme.layout.controlMinUnified,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
  clearLabel: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
  },
  list: {
    gap: theme.spacing.sm,
  },
  chip: {
    maxWidth: 180,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
  },
  chipLabel: {
    flexShrink: 1,
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.medium,
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
});
