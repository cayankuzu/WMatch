import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { theme } from '../../../shared/theme';
import { resolveDeviceEdgeInset } from '../../../shared/utils/safeArea';
import useReducedMotion from '../../hooks/useReducedMotion';

interface TransientPopupProps {
  message?: string | null;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  bottomOffset?: number;
}

export default function TransientPopup({
  message,
  icon = 'information-outline',
  bottomOffset = 0,
}: TransientPopupProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const safeBottomInset = resolveDeviceEdgeInset(insets.bottom);

  if (!message) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(reduceMotion ? 0 : theme.motion.normal)}
      exiting={FadeOutDown.duration(reduceMotion ? 0 : theme.motion.fast)}
      pointerEvents="none"
      style={[styles.shell, { bottom: safeBottomInset + bottomOffset + theme.spacing.md }]}
    >
      <View accessibilityLiveRegion="polite" style={styles.card}>
        <MaterialCommunityIcons name={icon} size={17} color={theme.colors.primarySoft} />
        <Text style={styles.message}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 80,
    elevation: 80,
    alignItems: 'center',
  },
  card: {
    maxWidth: 420,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.primarySurface,
    backgroundColor: theme.colors.glass,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: theme.colors.black,
    ...theme.elevation.floatingShadow,
  },
  message: {
    flexShrink: 1,
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
    textAlign: 'center',
  },
});
