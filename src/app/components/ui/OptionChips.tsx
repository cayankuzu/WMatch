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
            hitSlop={6}
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
    minHeight: 36,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    ...theme.typography.roles.control,
  },
  labelActive: {
    color: theme.colors.primarySoft,
  },
});
