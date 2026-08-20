import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';
import { triggerHaptic, type HapticFeedback } from '../../../services/haptics';
import useDelayedBusy from '../../hooks/useDelayedBusy';
import useReducedMotion from '../../hooks/useReducedMotion';

type Variant = 'primary' | 'secondary' | 'tonal' | 'ghost' | 'danger' | 'warning';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingTitle?: string;
  variant?: Variant;
  size?: 'regular' | 'large';
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  feedback?: HapticFeedback;
}

export default function AppButton({
  title,
  onPress,
  disabled = false,
  loading = false,
  loadingTitle,
  variant = 'primary',
  size = 'regular',
  leftIcon,
  rightIcon,
  feedback,
}: AppButtonProps) {
  const reduceMotionEnabled = useReducedMotion();
  const showSpinner = useDelayedBusy(loading);
  const isDisabled = disabled || loading;
  const visibleTitle = loading ? loadingTitle ?? title : title;
  const resolvedFeedback = feedback ?? (variant === 'ghost' ? 'none' : 'selection');

  return (
    <Pressable
      disabled={isDisabled}
      hitSlop={4}
      onPress={() => {
        triggerHaptic(resolvedFeedback);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'large' && styles.large,
        variantStyles[variant],
        pressed && !isDisabled && (reduceMotionEnabled ? styles.pressedStatic : styles.pressedMotion),
        isDisabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        {showSpinner ? (
          <ActivityIndicator
            color={variant === 'warning' ? theme.colors.black : labelStyles[variant].color}
            size="small"
          />
        ) : loading ? null : leftIcon}
        <Text style={[styles.label, labelStyles[variant], isDisabled && styles.disabledLabel]}>
          {visibleTitle}
        </Text>
        {!loading ? rightIcon : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  large: {
    minHeight: theme.layout.controlMinUnified,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  label: {
    ...theme.typography.roles.control,
    textAlign: 'center',
    flexShrink: 1,
  },
  pressedStatic: {
    backgroundColor: theme.colors.surfaceStrong,
  },
  pressedMotion: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  disabled: {
    backgroundColor: theme.colors.disabledSurface,
    borderColor: theme.colors.border,
  },
  disabledLabel: {
    color: theme.colors.disabledText,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: theme.colors.primary,
  },
  secondary: {
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tonal: {
    backgroundColor: theme.colors.primarySurface,
    borderWidth: 1,
    borderColor: theme.alpha.brand26,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: theme.colors.danger,
  },
  warning: {
    backgroundColor: theme.colors.star,
  },
});

const labelStyles = StyleSheet.create({
  primary: {
    color: theme.colors.white,
  },
  secondary: {
    color: theme.colors.text,
  },
  tonal: {
    color: theme.colors.primarySoft,
  },
  ghost: {
    color: theme.colors.text,
  },
  danger: {
    color: theme.colors.white,
  },
  warning: {
    color: theme.colors.black,
  },
});
