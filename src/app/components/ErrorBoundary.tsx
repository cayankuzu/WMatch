import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { theme } from '../../shared/theme';
import { telemetry } from '../../services/telemetry';
import { useLocalization } from '../../context/LocalizationContext';

interface ErrorBoundaryProps {
  children: ReactNode;
  surface?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocalization();

  return (
    <View accessibilityRole="alert" style={styles.container}>
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name="alert-circle-outline" size={24} color={theme.colors.primarySoft} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{t('errorBoundary.title')}</Text>
      <Text style={styles.description}>{t('errorBoundary.description')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('errorBoundary.retry')}
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>{t('errorBoundary.retry')}</Text>
      </Pressable>
    </View>
  );
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    telemetry.captureException(error, {
      componentStack: info.componentStack,
      surface: this.props.surface ?? 'react-error-boundary',
    });
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return <ErrorFallback onRetry={this.reset} />;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: theme.colors.background,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
    borderWidth: 1,
    borderColor: theme.alpha.dangerBorder,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.title,
    fontFamily: theme.fonts.extraBold,
    textAlign: 'center',
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: theme.colors.primary,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonText: {
    color: theme.colors.white,
    fontSize: theme.typography.body,
    fontFamily: theme.fonts.bold,
  },
});
