import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { useLocalization } from '../../context/LocalizationContext';
import Screen from './ui/Screen';
import { theme } from '../../shared/theme';

interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  const { t } = useLocalization();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const slowTimer = setTimeout(() => setElapsedMs(5000), 5000);
    const retryTimer = setTimeout(() => setElapsedMs(12000), 12000);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(retryTimer);
    };
  }, []);

  return (
    <Screen contentContainerStyle={styles.container}>
      <View accessibilityLiveRegion="polite" style={styles.card}>
        <ActivityIndicator color={theme.colors.primarySoft} size="large" />
        <Text style={styles.text}>{message ?? t('common.loading')}</Text>
        {elapsedMs >= 5000 ? <Text style={styles.delayText}>{t('app.loading.slow')}</Text> : null}
        {elapsedMs >= 12000 ? <Text style={styles.delayText}>{t('app.loading.retryHint')}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  card: {
    minWidth: 190,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    gap: 12,
  },
  text: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
  delayText: {
    maxWidth: 260,
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
});
