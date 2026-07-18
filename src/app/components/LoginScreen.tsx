import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';
import AppTextField from './ui/AppTextField';
import AuthFooter from './ui/AuthFooter';
import AuthLegalConsent from './ui/AuthLegalConsent';
import AuthWordmark from './ui/AuthWordmark';
import Screen from './ui/Screen';

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignUp: () => void;
  onForgotPassword: () => void;
}

export default function LoginScreen({
  onLogin,
  onSignUp,
  onForgotPassword,
}: LoginScreenProps) {
  const { t } = useLocalization();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const isUnlocked = acceptedLegal;

  const handleSubmit = async () => {
    if (loading) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setError(t('auth.login.error.missingFields'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onLogin(normalizedEmail, password);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('auth.login.error.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.container}>
      <View style={styles.stack}>
        <View style={styles.hero}>
          <AuthWordmark />
        </View>

        <View style={styles.formCard}>
          <AuthLegalConsent
            checked={acceptedLegal}
            onToggle={() => setAcceptedLegal((current) => !current)}
          />

          <View
            pointerEvents={isUnlocked ? 'auto' : 'none'}
            style={[styles.lockedSection, !isUnlocked && styles.lockedSectionDisabled]}
          >
            <AppTextField
              label={t('common.email')}
              value={email}
              onChangeText={(value) => setEmail(value.replace(/\s+/g, '').toLowerCase())}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              placeholder="ornek@email.com"
              editable={isUnlocked}
              leftIcon={<MaterialCommunityIcons name="email-outline" size={17} color={theme.colors.textSoft} />}
            />
            <AppTextField
              label={t('common.password')}
              value={password}
              onChangeText={setPassword}
              editable={isUnlocked}
              secureTextEntry={!showPassword}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={() => void handleSubmit()}
              placeholder="********"
              leftIcon={<MaterialCommunityIcons name="lock-outline" size={17} color={theme.colors.textSoft} />}
              rightIcon={
                <MaterialCommunityIcons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={17}
                  color={theme.colors.textSoft}
                />
              }
              onRightIconPress={isUnlocked ? () => setShowPassword((current) => !current) : undefined}
            />

            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

            <Pressable accessibilityRole="button" disabled={!isUnlocked} onPress={onForgotPassword} style={styles.forgotButton}>
              <Text style={styles.forgotText}>{t('auth.login.forgotPassword')}</Text>
            </Pressable>

            <AppButton
              title={t('auth.login.submit')}
              onPress={handleSubmit}
              loading={loading}
              disabled={!isUnlocked || !email.trim() || !password}
            />

            <Pressable accessibilityRole="button" disabled={!isUnlocked} onPress={onSignUp} style={styles.footerAction}>
              <Text style={styles.footerText}>
                {t('auth.login.signUpPrompt')} <Text style={styles.footerHighlight}>{t('auth.login.signUpCta')}</Text>
              </Text>
            </Pressable>
          </View>
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
  stack: {
    gap: 18,
    marginTop: 46,
  },
  hero: {
    alignItems: 'center',
    gap: 8,
  },
  formCard: {
    borderRadius: 22,
    backgroundColor: theme.alpha.panel92,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 15,
    gap: 12,
  },
  lockedSection: {
    gap: 12,
  },
  lockedSectionDisabled: {
    opacity: 0.46,
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.body,
    fontWeight: '700',
  },
  forgotButton: {
    alignSelf: 'flex-end',
  },
  forgotText: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.body,
    fontWeight: '700',
  },
  footerAction: {
    alignItems: 'center',
  },
  footerText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  footerHighlight: {
    color: theme.colors.primarySoft,
  },
});
