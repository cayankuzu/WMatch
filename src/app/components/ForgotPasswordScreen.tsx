import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';
import AppTextField from './ui/AppTextField';
import AuthFooter from './ui/AuthFooter';
import Screen from './ui/Screen';

interface ForgotPasswordScreenProps {
  onSendResetEmail: (email: string) => Promise<void>;
  onBackToLogin: () => void;
}

export default function ForgotPasswordScreen({
  onSendResetEmail,
  onBackToLogin,
}: ForgotPasswordScreenProps) {
  const { t } = useLocalization();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (loading) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setError(t('auth.forgot.error.missingEmail'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSendResetEmail(normalizedEmail);
      setSent(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('auth.forgot.error.sendFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <Pressable accessibilityRole="button" onPress={onBackToLogin} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.text} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>

        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="email-fast-outline" size={24} color={theme.colors.primarySoft} />
          </View>
          <Text style={styles.title}>{t('auth.forgot.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.forgot.subtitle')}</Text>

          {sent ? (
            <>
              <Text style={styles.successTitle}>{t('auth.forgot.sentTitle')}</Text>
              <Text style={styles.successText}>{t('auth.forgot.sentDescription', { email })}</Text>
              <AppButton title={t('auth.forgot.backToLogin')} onPress={onBackToLogin} />
            </>
          ) : (
            <>
              <AppTextField
                label={t('common.email')}
                value={email}
                onChangeText={(value) => setEmail(value.replace(/\s+/g, '').toLowerCase())}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="done"
                onSubmitEditing={() => void handleSubmit()}
                placeholder="ornek@email.com"
                leftIcon={<MaterialCommunityIcons name="email-outline" size={17} color={theme.colors.textSoft} />}
              />
              {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
              <AppButton
                title={t('auth.forgot.submit')}
                onPress={handleSubmit}
                loading={loading}
                disabled={!email.trim()}
              />
            </>
          )}
        </View>
      </View>

      <AuthFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    justifyContent: 'space-between',
  },
  content: {
    gap: 16,
    marginTop: 26,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '700',
  },
  card: {
    borderRadius: 22,
    backgroundColor: theme.alpha.panel92,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    gap: 12,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.title,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0,
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center',
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.body,
    fontWeight: '700',
  },
  successTitle: {
    color: theme.colors.success,
    fontSize: theme.typography.section,
    fontWeight: '800',
    textAlign: 'center',
  },
  successText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    textAlign: 'center',
  },
});
