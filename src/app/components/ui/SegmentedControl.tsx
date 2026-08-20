import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';
import { triggerHaptic } from '../../../services/haptics';

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
            hitSlop={4}
            onPress={() => {
              if (!active) {
                triggerHaptic('selection');
                onChange(option.value);
              }
            }}
            style={({ pressed }) => [
              styles.option,
              compact && styles.optionCompact,
              active && styles.optionActive,
              pressed && !active && styles.optionPressed,
            ]}
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
    paddingHorizontal: 8,
  },
  optionActive: {
    backgroundColor: theme.colors.primary,
    borderColor: 'transparent',
  },
  optionPressed: {
    opacity: theme.interaction.pressedOpacity,
    backgroundColor: theme.colors.surfaceMuted,
  },
  label: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.control,
    textAlign: 'center',
  },
  labelCompact: {
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
  },
  labelActive: {
    color: theme.colors.white,
  },
});
