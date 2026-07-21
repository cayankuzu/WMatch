import { useMemo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import {
  DAILY_DISLIKE_SWIPE_LIMIT,
  DAILY_LIKE_SWIPE_LIMIT,
  DAILY_UNDO_LIMIT,
} from '../../shared/constants';
import { theme } from '../../shared/theme';
import type { SwipeQuotaKind } from '../../shared/types';
import { formatRemainingTime } from '../../shared/utils/discovery';
import { resolveDeviceEdgeInset } from '../../shared/utils/safeArea';

interface SwipeQuotaBarProps {
  remainingLikes: number;
  remainingDislikes: number;
  remainingUndos: number;
  remainingMs: number;
  loading?: boolean;
  activeKinds?: SwipeQuotaKind[];
  bottomOffset?: number;
  respectSafeArea?: boolean;
}

export default function SwipeQuotaBar({
  remainingLikes,
  remainingDislikes,
  remainingUndos,
  remainingMs,
  loading = false,
  activeKinds,
  bottomOffset = 0,
  respectSafeArea = true,
}: SwipeQuotaBarProps) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const safeBottomInset = respectSafeArea ? resolveDeviceEdgeInset(insets.bottom) : 0;
  const activeSet = useMemo(
    () => new Set<SwipeQuotaKind>(activeKinds ?? ['like', 'dislike', 'undo']),
    [activeKinds],
  );
  return (
    <View
      pointerEvents="none"
      style={[styles.shell, { bottom: Math.max(8, bottomOffset + safeBottomInset + 8) }]}
    >
      <View
        accessible
        accessibilityLabel={`${t('quota.like')} ${remainingLikes}/${DAILY_LIKE_SWIPE_LIMIT}. ${t('quota.dislike')} ${remainingDislikes}/${DAILY_DISLIKE_SWIPE_LIMIT}. ${t('quota.undo')} ${remainingUndos}/${DAILY_UNDO_LIMIT}. ${t('quota.refresh')} ${formatRemainingTime(remainingMs)}.`}
        style={styles.card}
      >
        <QuotaPill
          active={activeSet.has('like')}
          icon="heart"
          iconColor={theme.colors.primarySoft}
          label={t('quota.like')}
          value={loading ? '--' : `${remainingLikes}/${DAILY_LIKE_SWIPE_LIMIT}`}
          primary
        />

        <View style={styles.secondaryQuotas}>
          <CompactQuota
            active={activeSet.has('dislike')}
            icon="close"
            value={loading ? '--' : `${remainingDislikes}`}
          />
          <CompactQuota
            active={activeSet.has('undo')}
            icon="undo-variant"
            value={loading ? '--' : `${remainingUndos}`}
          />
          <CompactQuota
            active
            icon="timer-outline"
            value={loading ? '--:--' : formatRemainingTime(remainingMs)}
            timer
          />
        </View>
      </View>
    </View>
  );
}

function QuotaPill({
  active = true,
  align = 'left',
  icon,
  iconColor,
  label,
  value,
  primary = false,
}: {
  active?: boolean;
  align?: 'left' | 'right';
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  label: string;
  value: string;
  primary?: boolean;
}) {
  const resolvedIconColor = active ? iconColor : theme.colors.textSoft;

  return (
    <View style={[styles.pill, primary && styles.pillPrimary, !active && styles.pillMuted, align === 'right' && styles.pillRight]}>
      <View style={[styles.labelRow, align === 'right' && styles.labelRowRight]}>
        <MaterialCommunityIcons accessible={false} name={icon} size={14} color={resolvedIconColor} />
        <Text style={[styles.pillLabel, !active && styles.pillTextMuted]}>{label}</Text>
      </View>
      <Text style={[styles.pillValue, !active && styles.pillTextMuted]}>{value}</Text>
    </View>
  );
}

function CompactQuota({
  active,
  icon,
  value,
  timer = false,
}: {
  active: boolean;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  value: string;
  timer?: boolean;
}) {
  return (
    <View style={[styles.compactQuota, !active && styles.pillMuted]}>
      <MaterialCommunityIcons
        accessible={false}
        name={icon}
        size={14}
        color={active ? theme.colors.textMuted : theme.colors.textSoft}
      />
      <Text style={[styles.compactQuotaValue, timer && styles.timerValue, !active && styles.pillTextMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 30,
    elevation: 30,
  },
  card: {
    minHeight: 44,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.glass,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pill: {
    minWidth: 72,
    gap: 2,
  },
  pillPrimary: {
    flexGrow: 1,
  },
  pillRight: {
    alignItems: 'flex-end',
  },
  pillMuted: {
    opacity: 1,
  },
  pillTextMuted: {
    color: theme.colors.textTertiary,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  labelRowRight: {
    justifyContent: 'flex-end',
  },
  pillLabel: {
    color: theme.colors.textSoft,
    ...theme.typography.roles.micro,
  },
  pillValue: {
    color: theme.colors.white,
    ...theme.typography.roles.cardTitle,
    fontVariant: ['tabular-nums'],
  },
  secondaryQuotas: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  compactQuota: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 6,
  },
  compactQuotaValue: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.micro,
    fontVariant: ['tabular-nums'],
  },
  timerValue: {
    color: theme.colors.warningText,
  },
});
