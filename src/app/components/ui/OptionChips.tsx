import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';

export interface OptionChipItem<T extends string> {
  label: string;
  value: T;
}

interface OptionChipsProps<T extends string> {
  options: Array<OptionChipItem<T>>;
  value: T | null;
  onChange: (value: T) => void;
}

export default function OptionChips<T extends string>({ options, value, onChange }: OptionChipsProps<T>) {
  return (
    <View style={styles.wrap}>
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: active }}
            hitSlop={4}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.chipPressed,
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySurface,
  },
  chipPressed: {
    opacity: 0.9,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.label.fontSize,
    lineHeight: theme.typography.roles.label.lineHeight,
    fontWeight: '800',
  },
  labelActive: {
    color: theme.colors.primarySoft,
  },
});
