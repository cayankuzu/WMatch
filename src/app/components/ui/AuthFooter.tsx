import { StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { theme } from '../../../shared/theme';

export default function AuthFooter() {
  const { t } = useLocalization();
  const currentYear = new Date().getFullYear();

  return (
    <View style={styles.container}>
      <Text style={styles.copy}>{t('auth.footer.copy', { year: currentYear })}</Text>
      <Text style={styles.powered}>{t('auth.footer.poweredBy')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  copy: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.semibold,
    letterSpacing: 0,
  },
  powered: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.bold,
    letterSpacing: 0,
  },
});
