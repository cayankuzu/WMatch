import { StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { theme } from '../../../shared/theme';

interface SignUpProgressProps {
  step: number;
}

export default function SignUpProgress({ step }: SignUpProgressProps) {
  const { t } = useLocalization();
  const labels = [
    t('auth.signup.stepLabel.account'),
    t('auth.signup.stepLabel.profile'),
    t('auth.signup.stepLabel.photos'),
    t('auth.signup.stepLabel.review'),
  ];

  return (
    <View accessibilityLabel={t('auth.signup.stepCounter', { step })} style={styles.container}>
      <View style={styles.bars}>
        {labels.map((label, index) => (
          <View key={label} style={[styles.bar, index + 1 <= step && styles.barActive]} />
        ))}
      </View>
      <View style={styles.labels}>
        {labels.map((label, index) => (
          <Text
            key={label}
            numberOfLines={1}
            style={[styles.label, index + 1 === step && styles.labelActive]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.xs,
  },
  bars: {
    flexDirection: 'row',
    gap: 5,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surfaceStrong,
  },
  barActive: {
    backgroundColor: theme.colors.primary,
  },
  labels: {
    flexDirection: 'row',
    gap: 5,
  },
  label: {
    flex: 1,
    color: theme.colors.textSoft,
    ...theme.typography.roles.micro,
    textAlign: 'center',
  },
  labelActive: {
    color: theme.colors.primarySoft,
  },
});
