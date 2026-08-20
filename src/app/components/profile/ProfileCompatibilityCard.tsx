import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { theme } from '../../../shared/theme';
import { getCompatibilityStyle } from '../../../shared/theme/compatibility';

interface ProfileCompatibilityCardProps {
  score: number;
  onPress?: () => void;
}

function ProfileCompatibilityCard({ score, onPress }: ProfileCompatibilityCardProps) {
  const { t } = useLocalization();
  const style = getCompatibilityStyle(score);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('profile.card.compatibility.label')} %${score}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.header}>
        <Text style={styles.label}>{t('profile.card.compatibility.label')}</Text>
        <Text style={styles.hint}>{t('profile.card.compatibility.hint')}</Text>
      </View>
      <View style={styles.barWrap}>
        <View style={[styles.track, { backgroundColor: style.track }]}>
          <View style={[styles.fill, { width: `${Math.min(score, 100)}%`, backgroundColor: style.color }]} />
        </View>
        <Text style={[styles.score, { color: style.color }]}>%{score}</Text>
      </View>
    </Pressable>
  );
}

export default memo(ProfileCompatibilityCard);

const styles = StyleSheet.create({
  card: {
    minHeight: 56,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  pressed: { opacity: theme.interaction.pressedOpacity },
  header: { gap: 2 },
  label: { color: theme.colors.text, ...theme.typography.roles.cardTitle },
  hint: { color: theme.colors.textMuted, ...theme.typography.roles.meta, marginTop: 1 },
  barWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 7, borderRadius: theme.radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: theme.radius.pill },
  score: {
    minWidth: 40,
    ...theme.typography.roles.sectionTitle,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
});
