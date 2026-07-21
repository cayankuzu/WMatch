import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { theme } from '../../../shared/theme';
import AppButton from './AppButton';
import AppText from './AppText';
import DelayedActivityIndicator from './DelayedActivityIndicator';

export type DataVisualState =
  | 'initial-loading'
  | 'cached-stale'
  | 'refreshing'
  | 'loading-more'
  | 'ready'
  | 'empty'
  | 'search-empty'
  | 'partial-error'
  | 'fatal-error'
  | 'offline';

interface DataStateProps {
  state: DataVisualState;
  title?: string;
  description?: string;
  actionLabel?: string;
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  children?: ReactNode;
  onAction?: () => void;
}

export default function DataState({
  state,
  title,
  description,
  actionLabel,
  icon,
  children,
  onAction,
}: DataStateProps) {
  if (state === 'ready' || state === 'refreshing' || state === 'cached-stale' || state === 'loading-more') {
    return <>{children}</>;
  }

  const isLoading = state === 'initial-loading';
  const resolvedIcon =
    icon ??
    (state === 'offline'
      ? 'wifi-off'
      : state.includes('error')
        ? 'alert-circle-outline'
        : state.includes('empty')
          ? 'movie-open-outline'
          : 'loading');

  return (
    <View
      accessibilityLiveRegion={isLoading ? 'polite' : 'assertive'}
      accessibilityRole={state.includes('error') ? 'alert' : undefined}
      style={styles.container}
    >
      <View style={styles.iconShell}>
        {isLoading ? (
          <DelayedActivityIndicator active color={theme.colors.accentText} />
        ) : (
          <MaterialCommunityIcons
            accessible={false}
            name={resolvedIcon}
            size={theme.icon.lg}
            color={state.includes('error') ? theme.colors.dangerText : theme.colors.accentText}
          />
        )}
      </View>
      {title ? (
        <AppText align="center" variant="sectionTitle" weight="800">
          {title}
        </AppText>
      ) : null}
      {description ? (
        <AppText align="center" tone="secondary" variant="body">
          {description}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton title={actionLabel} onPress={onAction} variant={state.includes('error') ? 'danger' : 'secondary'} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  iconShell: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.borderDefault,
    backgroundColor: theme.colors.surfaceStrong,
  },
});
