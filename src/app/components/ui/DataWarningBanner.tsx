import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';

interface DataWarningBannerProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function DataWarningBanner({
  title,
  description,
  actionLabel,
  onAction,
}: DataWarningBannerProps) {
  return (
    <View accessibilityRole="alert" style={styles.container}>
      <MaterialCommunityIcons name="cloud-alert-outline" size={20} color={theme.colors.warningText} />
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: theme.colors.warning,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.warningSurface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: theme.colors.warningText,
    fontSize: theme.typography.caption,
    fontWeight: '900',
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 17,
    fontWeight: '600',
  },
  action: {
    minHeight: 32,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  actionText: {
    color: theme.colors.warningText,
    fontSize: theme.typography.caption,
    fontWeight: '900',
  },
});
