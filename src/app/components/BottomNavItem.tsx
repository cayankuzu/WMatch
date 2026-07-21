import { useEffect } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { triggerHaptic } from '../../services/haptics';
import { theme } from '../../shared/theme';
import useReducedMotion from '../hooks/useReducedMotion';

interface BottomNavItemProps {
  active: boolean;
  compact: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  activeIcon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  badge?: number;
  onIntent?: () => void;
  onPress: () => void;
}

export default function BottomNavItem({
  active,
  compact,
  icon,
  activeIcon,
  label,
  badge = 0,
  onIntent,
  onPress,
}: BottomNavItemProps) {
  const reduceMotion = useReducedMotion();
  const selectedProgress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    selectedProgress.value = withTiming(active ? 1 : 0, {
      duration: reduceMotion ? 0 : theme.motion.fast,
    });
  }, [active, reduceMotion, selectedProgress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + selectedProgress.value * 0.025 }],
  }));
  const showLabel = !compact || active;

  return (
    <Animated.View style={[styles.shell, animatedStyle]}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        android_ripple={{ color: theme.colors.primarySurface, borderless: false }}
        hitSlop={6}
        onPressIn={onIntent}
        onPress={() => {
          triggerHaptic('selection');
          onPress();
        }}
        style={({ pressed }) => [
          styles.item,
          active && styles.activeItem,
          pressed && styles.pressedItem,
        ]}
      >
        {active ? <View style={styles.activeIndicator} /> : null}
        <View style={styles.iconShell}>
          <MaterialCommunityIcons
            accessible={false}
            name={active ? activeIcon : icon}
            size={compact ? theme.icon.lg : theme.icon.md}
            color={active ? theme.colors.primarySoft : theme.colors.textSoft}
          />
          {badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          ) : null}
        </View>
        {showLabel ? (
          <Text
            numberOfLines={compact ? 1 : 2}
            style={[styles.label, compact && styles.labelCompact, active && styles.activeLabel]}
          >
            {label}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  item: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: theme.spacing.xs,
  },
  activeItem: {
    backgroundColor: theme.colors.primarySurface,
  },
  activeIndicator: {
    position: 'absolute',
    top: 3,
    width: 16,
    height: 2,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
  pressedItem: {
    opacity: theme.interaction.pressedOpacity,
    backgroundColor: theme.colors.surfaceStrong,
  },
  iconShell: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -12,
    minWidth: 18,
    height: 18,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.glass,
    backgroundColor: theme.colors.notificationAccent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: theme.colors.white,
    fontSize: theme.typography.roles.micro.fontSize,
    lineHeight: theme.typography.roles.micro.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  label: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    textAlign: 'center',
  },
  labelCompact: {
    ...theme.typography.roles.micro,
  },
  activeLabel: {
    color: theme.colors.primarySoft,
  },
});
