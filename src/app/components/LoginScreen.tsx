import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';
import AppTextField from './ui/AppTextField';
import AuthFooter from './ui/AuthFooter';
import AuthLegalNotice from './ui/AuthLegalNotice';
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
          <View style={styles.formFields}>
            <AppTextField
              label={t('common.email')}
              value={email}
              onChangeText={(value) => setEmail(value.replace(/\s+/g, '').toLowerCase())}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              placeholder="ornek@email.com"
              leftIcon={<MaterialCommunityIcons name="email-outline" size={17} color={theme.colors.textSoft} />}
            />
            <AppTextField
              label={t('common.password')}
              value={password}
              onChangeText={setPassword}
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
              onRightIconPress={() => setShowPassword((current) => !current)}
            />

            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

            <Pressable accessibilityRole="button" onPress={onForgotPassword} style={styles.forgotButton}>
              <Text style={styles.forgotText}>{t('auth.login.forgotPassword')}</Text>
            </Pressable>

            <AppButton
              title={t('auth.login.submit')}
              onPress={handleSubmit}
              loading={loading}
              disabled={!email.trim() || !password}
            />

            <Pressable accessibilityRole="button" onPress={onSignUp} style={styles.footerAction}>
              <Text style={styles.footerText}>
                {t('auth.login.signUpPrompt')} <Text style={styles.footerHighlight}>{t('auth.login.signUpCta')}</Text>
              </Text>
            </Pressable>

            <AuthLegalNotice />
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
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
    justifyContent: 'space-between',
  },
  stack: {
    gap: 14,
    marginTop: 16,
  },
  hero: {
    alignItems: 'center',
    gap: 6,
  },
  formCard: {
    borderRadius: theme.radius.card,
    backgroundColor: theme.alpha.panel92,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 15,
    gap: 10,
  },
  formFields: {
    gap: 10,
  },
  error: {
    color: theme.colors.dangerText,
    ...theme.typography.roles.body,
    fontFamily: theme.fonts.semibold,
  },
  forgotButton: {
    minHeight: theme.layout.controlMinUnified,
    alignSelf: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xs,
  },
  forgotText: {
    color: theme.colors.primarySoft,
    ...theme.typography.roles.control,
  },
  footerAction: {
    minHeight: theme.layout.controlMinUnified,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerText: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
  },
  footerHighlight: {
    color: theme.colors.primarySoft,
  },
});
