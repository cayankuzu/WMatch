import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useConnectivity } from '../../../services/connectivity';
import { theme } from '../../../shared/theme';
import { useLocalization } from '../../../context/LocalizationContext';

export default function ConnectivityBanner() {
  const { t } = useLocalization();
  const connectivity = useConnectivity();
  const offline = !connectivity.connected || !connectivity.internetReachable;

  if (!offline) {
    return null;
  }

  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.banner}>
      <MaterialCommunityIcons
        accessible={false}
        color={theme.colors.warningText}
        name="wifi-off"
        size={theme.icon.sm}
      />
      <Text style={styles.message}>{t('data.offline.cached')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 36,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.warningSurface,
    backgroundColor: theme.colors.backgroundElevated,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  message: {
    flexShrink: 1,
    color: theme.colors.warningText,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.semibold,
    textAlign: 'center',
  },
});
