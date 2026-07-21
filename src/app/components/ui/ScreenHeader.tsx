import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '../../../shared/theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  trailing,
  style,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.xs,
  },
  eyebrow: {
    color: theme.colors.primarySoft,
    fontFamily: theme.fonts.semibold,
    fontSize: theme.typography.roles.micro.fontSize,
    lineHeight: theme.typography.roles.micro.lineHeight,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.textPrimary,
    ...theme.typography.roles.screenTitle,
  },
  subtitle: {
    color: theme.colors.textSecondary,
    ...theme.typography.roles.body,
  },
  trailing: {
    minHeight: theme.layout.controlMinUnified,
    justifyContent: 'center',
  },
});
