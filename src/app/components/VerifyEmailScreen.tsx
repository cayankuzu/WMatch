import { useEffect, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';
import AuthFooter from './ui/AuthFooter';
import Screen from './ui/Screen';

interface VerifyEmailScreenProps {
  email: string;
  onResendEmail: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export default function VerifyEmailScreen({
  email,
  onResendEmail,
  onLogout,
}: VerifyEmailScreenProps) {
  const { t } = useLocalization();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    if (cooldownRemaining <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      setCooldownRemaining((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [cooldownRemaining]);

  const handleResend = async () => {
    if (loading || cooldownRemaining > 0) {
      return;
    }

    setLoading(true);
    setStatus('idle');

    try {
      await onResendEmail();
      setStatus('sent');
      setCooldownRemaining(60);
    } catch {
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  const confirmLogout = () => {
    Alert.alert(t('settings.logout.title'), t('settings.logout.description'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.logout.confirm'), onPress: () => void onLogout() },
    ]);
  };

  return (
    <Screen scroll contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="email-check-outline" size={24} color={theme.colors.warningText} />
          </View>
          <Text style={styles.title}>{t('auth.verify.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.verify.subtitle', { email })}</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>{t('auth.verify.tipTitle')}</Text>
            <Text style={styles.infoText}>{t('auth.verify.tipDescription')}</Text>
          </View>
          {status === 'sent' ? (
            <Text accessibilityLiveRegion="polite" style={styles.success}>{t('auth.verify.success')}</Text>
          ) : null}
          {status === 'error' ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>{t('auth.verify.error')}</Text>
          ) : null}
          <AppButton
            title={
              cooldownRemaining > 0
                ? `${t('auth.verify.resend')} (${cooldownRemaining})`
                : t('auth.verify.resend')
            }
            onPress={handleResend}
            loading={loading}
            disabled={cooldownRemaining > 0}
          />
          <AppButton title={t('auth.verify.logout')} onPress={confirmLogout} variant="secondary" />
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
    flex: 1,
    justifyContent: 'center',
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
    backgroundColor: theme.alpha.warning14,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.title,
    fontWeight: '900',
    textAlign: 'center',
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    textAlign: 'center',
    lineHeight: 18,
  },
  infoCard: {
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    padding: 12,
    gap: 5,
  },
  infoTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '800',
  },
  infoText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    lineHeight: 17,
  },
  success: {
    color: theme.colors.success,
    fontSize: theme.typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
});
