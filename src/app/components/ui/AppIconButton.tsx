import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '../../../shared/theme';
import { triggerHaptic, type HapticFeedback } from '../../../services/haptics';
import useReducedMotion from '../../hooks/useReducedMotion';

interface AppIconButtonProps {
  icon: ReactNode;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  size?: 'regular' | 'large';
  variant?: 'ghost' | 'surface' | 'danger';
  style?: StyleProp<ViewStyle>;
  feedback?: HapticFeedback;
}

export default function AppIconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled = false,
  selected = false,
  size = 'regular',
  variant = 'ghost',
  style,
  feedback = 'selection',
}: AppIconButtonProps) {
  const reduceMotionEnabled = useReducedMotion();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        triggerHaptic(feedback);
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        size === 'large' && styles.large,
        variantStyles[variant],
        selected && styles.selected,
        pressed && !disabled && (reduceMotionEnabled ? styles.pressedStatic : styles.pressedMotion),
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  large: {
    minWidth: 46,
    minHeight: 46,
  },
  selected: {
    borderColor: theme.colors.borderFocus,
    backgroundColor: theme.colors.primarySurface,
  },
  pressedStatic: {
    backgroundColor: theme.colors.surfaceStrong,
  },
  pressedMotion: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.iconPressedScale }],
  },
  disabled: {
    backgroundColor: theme.colors.disabledSurface,
    borderColor: theme.colors.border,
  },
});

const variantStyles = StyleSheet.create({
  ghost: {
    backgroundColor: 'transparent',
  },
  surface: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  danger: {
    borderWidth: 1,
    borderColor: theme.colors.dangerSurface,
    backgroundColor: theme.colors.dangerSurface,
  },
});
