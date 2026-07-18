import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';
import { validatePassword } from '../../shared/utils/validation';
import AppButton from './ui/AppButton';
import AppTextField from './ui/AppTextField';
import AuthFooter from './ui/AuthFooter';
import Screen from './ui/Screen';

interface PasswordRecoveryScreenProps {
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => Promise<void>;
}

export default function PasswordRecoveryScreen({
  onSubmit,
  onCancel,
}: PasswordRecoveryScreenProps) {
  const { t } = useLocalization();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (loading) {
      return;
    }

    const passwordValidationMessage = validatePassword(password);
    if (passwordValidationMessage) {
      setError(passwordValidationMessage);
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth.recovery.error.passwordMismatch'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSubmit(password);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('auth.recovery.error.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.container}>
      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="lock-reset" size={24} color={theme.colors.primarySoft} />
          </View>
          <Text style={styles.title}>{t('auth.recovery.title')}</Text>
          <Text style={styles.subtitle}>{t('auth.recovery.subtitle')}</Text>

          <AppTextField
            label={t('auth.recovery.newPassword')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            placeholder="En az 8 karakter"
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
          <AppTextField
            label={t('auth.recovery.confirmPassword')}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={() => void handleSubmit()}
            placeholder={t('auth.signup.placeholder.confirmPassword')}
            leftIcon={<MaterialCommunityIcons name="lock-check-outline" size={17} color={theme.colors.textSoft} />}
          />
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
          <AppButton
            title={t('auth.recovery.submit')}
            onPress={handleSubmit}
            loading={loading}
            disabled={!password || !confirmPassword}
          />
          <AppButton title={t('auth.recovery.cancel')} onPress={() => void onCancel()} variant="secondary" />
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
  },
  subtitle: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    textAlign: 'center',
    lineHeight: 18,
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.body,
    fontWeight: '700',
  },
});
