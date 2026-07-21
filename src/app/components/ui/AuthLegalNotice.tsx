import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useLocalization } from '../../../context/LocalizationContext';
import { getPrivacyPolicyUrl, getTermsOfUseUrl } from '../../../shared/config/publicWeb';
import { theme } from '../../../shared/theme';

export default function AuthLegalNotice() {
  const { t } = useLocalization();

  const openExternalUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error('URL cannot be opened.');
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('auth.legal.linkErrorTitle'), t('auth.legal.linkErrorDescription'));
    }
  };

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="shield-check-outline" size={18} color={theme.colors.textSoft} />
      <Text style={styles.copy}>
        <Text>{t('auth.legal.loginPrefix')}</Text>
        <Text accessibilityRole="link" onPress={() => void openExternalUrl(getPrivacyPolicyUrl())} style={styles.link}>
          {t('auth.legal.privacyLabel')}
        </Text>
        <Text>{t('auth.legal.middle')}</Text>
        <Text accessibilityRole="link" onPress={() => void openExternalUrl(getTermsOfUseUrl())} style={styles.link}>
          {t('auth.legal.termsLabel')}
        </Text>
        <Text>{t('auth.legal.loginSuffix')}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.xs,
  },
  copy: {
    flex: 1,
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  link: {
    color: theme.colors.primarySoft,
    fontFamily: theme.fonts.semibold,
    textDecorationLine: 'underline',
  },
});
