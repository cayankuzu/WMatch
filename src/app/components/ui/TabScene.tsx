import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { theme } from '../../../shared/theme';
import useReducedMotion from '../../hooks/useReducedMotion';

interface TabSceneProps {
  active: boolean;
  children: ReactNode;
}

export default function TabScene({ active, children }: TabSceneProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, {
      duration: reduceMotion ? 0 : theme.motion.fast,
    });
  }, [active, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduceMotion ? 0 : (1 - progress.value) * 4 }],
  }));

  return (
    <Animated.View
      collapsable={false}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      pointerEvents={active ? 'auto' : 'none'}
      style={[styles.scene, !active && styles.inactiveScene, animatedStyle]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scene: {
    ...StyleSheet.absoluteFill,
  },
  inactiveScene: {
    zIndex: -1,
  },
});
