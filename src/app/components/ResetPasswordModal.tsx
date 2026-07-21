import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';
import AccessibleModal from './ui/AccessibleModal';

interface ResetPasswordModalProps {
  onClose: () => void;
}

export default function ResetPasswordModal({ onClose }: ResetPasswordModalProps) {
  const { t } = useLocalization();
  const { user, sendPasswordReset } = useAuth();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    if (!user?.email) return;

    setError('');
    setLoading(true);

    try {
      await sendPasswordReset(user.email);
      setSent(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('reset.password.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccessibleModal transparent visible animationType="fade" onRequestClose={onClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{sent ? t('reset.password.title.sent') : t('reset.password.title.ready')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={20} color={theme.colors.text} />
            </Pressable>
          </View>

          <View style={styles.body}>
            <View style={[styles.iconWrap, sent && styles.iconWrapSuccess]}>
              <MaterialCommunityIcons
                name={sent ? 'check-circle-outline' : 'email-outline'}
                size={22}
                color={sent ? theme.colors.successText : theme.colors.primarySoft}
              />
            </View>
            <Text style={styles.description}>
              {sent
                ? t('reset.password.description.sent', { email: user?.email ?? '' })
                : t('reset.password.description.ready', { email: user?.email ?? '' })}
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <AppButton
              title={sent ? t('common.ok') : t('reset.password.submit')}
              onPress={sent ? onClose : () => void handleSend()}
              loading={loading}
            />
          </View>
        </View>
      </View>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.scrim,
    padding: 18,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: theme.radius.personCard,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontFamily: theme.fonts.extraBold,
  },
  closeButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  body: {
    padding: 16,
    gap: 10,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  iconWrapSuccess: {
    backgroundColor: theme.colors.successSurface,
  },
  description: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.body,
    textAlign: 'center',
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: 12,
    fontFamily: theme.fonts.semibold,
    textAlign: 'center',
  },
});
