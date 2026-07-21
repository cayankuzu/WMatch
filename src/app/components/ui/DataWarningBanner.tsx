import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../shared/theme';
import { triggerHaptic } from '../../../services/haptics';

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
      <MaterialCommunityIcons name="cloud-alert-outline" size={theme.icon.md} color={theme.colors.warningText} />
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            triggerHaptic('selection');
            onAction();
          }}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
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
    gap: 8,
    borderWidth: 1,
    borderColor: theme.colors.warning,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.warningSurface,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: theme.colors.warningText,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.extraBold,
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 17,
    fontFamily: theme.fonts.medium,
  },
  action: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.warning,
  },
  actionText: {
    color: theme.colors.warningText,
    fontSize: theme.typography.caption,
    fontFamily: theme.fonts.extraBold,
  },
  actionPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
});
