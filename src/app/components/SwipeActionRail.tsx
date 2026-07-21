import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { theme } from '../../shared/theme';

interface SwipeActionRailProps {
  allowReject: boolean;
  allowLike: boolean;
  canUndo: boolean;
  onReject?: () => void;
  onLike?: () => void;
  onUndo?: () => void;
}

export default function SwipeActionRail({
  allowReject,
  allowLike,
  canUndo,
  onReject,
  onLike,
  onUndo,
}: SwipeActionRailProps) {
  const { t } = useLocalization();

  return (
    <View accessibilityRole="toolbar" style={styles.container}>
      <ActionButton
        accessibilityLabel={t('quota.dislike')}
        disabled={!allowReject}
        icon="close"
        iconColor={theme.colors.dangerText}
        onPress={onReject}
        tone="reject"
      />
      <ActionButton
        accessibilityLabel={t('quota.undo')}
        disabled={!canUndo}
        icon="undo-variant"
        iconColor={theme.colors.infoText}
        onPress={onUndo}
        tone="undo"
      />
      <ActionButton
        accessibilityLabel={t('quota.like')}
        disabled={!allowLike}
        icon="heart"
        iconColor={theme.colors.white}
        onPress={onLike}
        tone="like"
      />
    </View>
  );
}

function ActionButton({
  accessibilityLabel,
  disabled,
  icon,
  iconColor,
  onPress,
  tone,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  onPress?: () => void;
  tone: 'reject' | 'undo' | 'like';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'reject' && styles.reject,
        tone === 'undo' && styles.undo,
        tone === 'like' && styles.like,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <MaterialCommunityIcons name={icon} size={tone === 'undo' ? 18 : 20} color={iconColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    paddingHorizontal: theme.layout.screenGutterCompact,
    paddingTop: theme.spacing.md,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.elevation.cardShadow,
  },
  reject: {
    borderColor: theme.alpha.dangerBorder,
    backgroundColor: theme.colors.dangerSurface,
  },
  undo: {
    width: 40,
    height: 40,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.infoSurface,
  },
  like: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  disabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.iconPressedScale }],
  },
});
