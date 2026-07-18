import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';
import useReducedMotion from '../../hooks/useReducedMotion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning';

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
}: AppButtonProps) {
  const reduceMotionEnabled = useReducedMotion();
  const isDisabled = disabled || loading;
  const visibleTitle = loading ? loadingTitle ?? title : title;

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
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
        {loading ? (
          <ActivityIndicator
            color={variant === 'warning' ? theme.colors.black : labelStyles[variant].color}
            size="small"
          />
        ) : (
          leftIcon
        )}
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
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  large: {
    minHeight: 54,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  label: {
    fontSize: theme.typography.body,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  pressedStatic: {
    backgroundColor: theme.colors.surfaceStrong,
  },
  pressedMotion: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
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
