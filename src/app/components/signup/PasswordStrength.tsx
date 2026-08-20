import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { theme } from '../../../shared/theme';

interface PasswordCheck {
  key: string;
  label: string;
  passed: boolean;
}

interface PasswordStrengthProps {
  checks: PasswordCheck[];
  label: string;
  score: number;
}

function PasswordStrength({ checks, label, score }: PasswordStrengthProps) {
  const { t } = useLocalization();
  const strengthStyle = score >= 3
    ? styles.strong
    : score >= 2
      ? styles.medium
      : styles.weak;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('auth.signup.passwordStrength.title')}</Text>
        <Text style={[styles.label, strengthStyle]}>{label}</Text>
      </View>
      <View style={styles.meter}>
        {[0, 1, 2].map((item) => (
          <View
            key={item}
            style={[
              styles.segment,
              item < score && styles.segmentActive,
              item < score && score >= 3 && styles.segmentStrong,
              item < score && score === 2 && styles.segmentMedium,
            ]}
          />
        ))}
      </View>
      <View style={styles.checkList}>
        {checks.map((item) => (
          <View key={item.key} style={styles.checkRow}>
            <MaterialCommunityIcons
              name={item.passed ? 'check-circle' : 'circle-outline'}
              size={16}
              color={item.passed ? theme.colors.successText : theme.colors.textSoft}
            />
            <Text style={[styles.checkText, item.passed && styles.checkTextPassed]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 7,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.extraBold,
  },
  label: {
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.extraBold,
  },
  weak: { color: theme.colors.dangerText },
  medium: { color: theme.colors.warningText },
  strong: { color: theme.colors.successText },
  meter: {
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceStrong,
  },
  segmentActive: { backgroundColor: theme.colors.dangerText },
  segmentMedium: { backgroundColor: theme.colors.warningText },
  segmentStrong: { backgroundColor: theme.colors.successText },
  checkList: { gap: 5 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkText: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 17,
    fontFamily: theme.fonts.semibold,
  },
  checkTextPassed: { color: theme.colors.text },
});

export default memo(PasswordStrength);
