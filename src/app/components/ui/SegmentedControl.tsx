import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';

interface SegmentedOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'regular' | 'compact';
}

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'regular',
}: SegmentedControlProps<T>) {
  const compact = size === 'compact';

  return (
    <View accessibilityRole="tablist" style={[styles.container, compact && styles.containerCompact]}>
      {options.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.option, compact && styles.optionCompact, active && styles.optionActive]}
          >
            <Text style={[styles.label, compact && styles.labelCompact, active && styles.labelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
  },
  containerCompact: {
    gap: 4,
  },
  option: {
    flex: 1,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  optionCompact: {
    minHeight: theme.layout.controlMinUnified,
    paddingHorizontal: 10,
  },
  optionActive: {
    backgroundColor: theme.colors.primary,
    borderColor: 'transparent',
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.label.fontSize,
    lineHeight: theme.typography.roles.label.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelCompact: {
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  labelActive: {
    color: theme.colors.white,
  },
});
