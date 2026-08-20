import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { useLocalization } from '../../context/LocalizationContext';
import Screen from './ui/Screen';
import { theme } from '../../shared/theme';
import DelayedActivityIndicator from './ui/DelayedActivityIndicator';

interface LoadingScreenProps {
  message?: string;
  onRetry?: () => void;
}

export default function LoadingScreen({ message, onRetry }: LoadingScreenProps) {
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
        <DelayedActivityIndicator active color={theme.colors.primarySoft} size="large" />
        <Text style={styles.text}>{message ?? t('common.loading')}</Text>
        {elapsedMs >= 5000 ? <Text style={styles.delayText}>{t('app.loading.slow')}</Text> : null}
        {elapsedMs >= 12000 && onRetry ? (
          <>
            <Text style={styles.delayText}>{t('app.loading.retryHint')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            >
              <Text style={styles.retryText}>{t('data.action.retry')}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  card: {
    minWidth: 190,
    borderRadius: theme.radius.modal,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    gap: 10,
  },
  text: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.medium,
    textAlign: 'center',
  },
  delayText: {
    maxWidth: 260,
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.medium,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: theme.layout.controlMinUnified,
    minWidth: 96,
    borderRadius: theme.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: theme.colors.primary,
  },
  retryButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  retryText: {
    color: theme.colors.white,
    ...theme.typography.roles.control,
  },
});
