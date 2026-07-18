import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { getPrivacyPolicyUrl, getTermsOfUseUrl } from '../../../shared/config/publicWeb';
import { theme } from '../../../shared/theme';

interface AuthLegalConsentProps {
  checked: boolean;
  onToggle: () => void;
}

export default function AuthLegalConsent({
  checked,
  onToggle,
}: AuthLegalConsentProps) {
  const { t } = useLocalization();
  const privacyLabel = t('auth.legal.privacyLabel');
  const termsLabel = t('auth.legal.termsLabel');
  const consentLabel = `${privacyLabel}${t('auth.legal.middle')}${termsLabel}${t('auth.legal.suffix')}`;

  const openExternalUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);

      if (!supported) {
        throw new Error('URL cannot be opened.');
      }

      await Linking.openURL(url);
    } catch {
      Alert.alert(
        t('auth.legal.linkErrorTitle'),
        t('auth.legal.linkErrorDescription'),
      );
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={consentLabel}
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={styles.checkboxButton}
      >
        <MaterialCommunityIcons
          name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'}
          size={22}
          color={checked ? theme.colors.primarySoft : theme.colors.textSoft}
        />
      </Pressable>

      <Text style={styles.copy}>
        <Text accessibilityRole="link" onPress={() => void openExternalUrl(getPrivacyPolicyUrl())} style={styles.link}>
          {privacyLabel}
        </Text>
        <Text>{t('auth.legal.middle')}</Text>
        <Text accessibilityRole="link" onPress={() => void openExternalUrl(getTermsOfUseUrl())} style={styles.link}>
          {termsLabel}
        </Text>
        <Text>{t('auth.legal.suffix')}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  checkboxButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
  },
  copy: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    lineHeight: 21,
    fontWeight: '600',
  },
  link: {
    color: theme.colors.primarySoft,
    textDecorationLine: 'underline',
    fontWeight: '800',
  },
});
