import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';

interface ProfileTopBarProps {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  primaryIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onPrimaryPress?: () => void;
  secondaryIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  onSecondaryPress?: () => void;
}

export default function ProfileTopBar({
  title,
  subtitle,
  onBack,
  primaryIcon,
  onPrimaryPress,
  secondaryIcon,
  onSecondaryPress,
}: ProfileTopBarProps) {
  const { t } = useLocalization();
  const primaryLabel = primaryIcon === 'dots-vertical' ? t('a11y.profileMenu') : t('a11y.profileAction');
  const secondaryLabel = secondaryIcon === 'flag-outline' ? t('a11y.reportProfile') : t('a11y.secondaryProfileAction');

  return (
    <View style={styles.container}>
      {onBack ? (
        <TopBarButton label={t('common.back')} icon="arrow-left" onPress={onBack} />
      ) : <View style={styles.spacer} />}

      {title ? (
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        {onPrimaryPress && primaryIcon ? <TopBarButton label={primaryLabel} icon={primaryIcon} onPress={onPrimaryPress} /> : null}
        {onSecondaryPress && secondaryIcon ? <TopBarButton label={secondaryLabel} icon={secondaryIcon} onPress={onSecondaryPress} /> : null}
        {!onPrimaryPress && !onSecondaryPress ? <View style={styles.spacer} /> : null}
      </View>
    </View>
  );
}

function TopBarButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.button}>
      <MaterialCommunityIcons name={icon} size={20} color={theme.colors.primarySoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: theme.layout.screenGutterCompact,
    marginTop: 8,
    marginBottom: 2,
    minHeight: 44,
    borderRadius: theme.radius.personCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.alpha.elevated96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  spacer: {
    width: theme.layout.controlMinUnified,
    height: theme.layout.controlMinUnified,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: theme.spacing.sm,
    gap: 1,
  },
  title: {
    color: theme.colors.text,
    ...theme.typography.roles.cardTitle,
  },
  subtitle: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.micro,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  button: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
});
