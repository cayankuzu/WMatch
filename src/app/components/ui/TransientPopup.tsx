import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../../../shared/theme';
import { resolveDeviceEdgeInset } from '../../../shared/utils/safeArea';

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
  const safeBottomInset = resolveDeviceEdgeInset(insets.bottom);

  if (!message) {
    return null;
  }

  return (
    <View pointerEvents="none" style={[styles.shell, { bottom: safeBottomInset + bottomOffset + 14 }]}>
      <View accessibilityLiveRegion="polite" style={styles.card}>
        <MaterialCommunityIcons name={icon} size={17} color={theme.colors.primarySoft} />
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
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
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.primarySurface,
    backgroundColor: theme.colors.glass,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    shadowColor: theme.colors.black,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  message: {
    flexShrink: 1,
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
    textAlign: 'center',
  },
});
