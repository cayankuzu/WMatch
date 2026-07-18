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
import useWindowClass from '../hooks/useWindowClass';

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
  const layout = useWindowClass();
  const safeBottomInset = respectSafeArea ? resolveDeviceEdgeInset(insets.bottom) : 0;
  const compactLayout = layout.widthClass === 'xCompact' || layout.fontScale >= 1.3;
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
        style={[styles.card, compactLayout && styles.cardCompact]}
      >
        <QuotaPill
          active={activeSet.has('like')}
          icon="arrow-right-thin"
          iconColor={theme.colors.success}
          label={t('quota.like')}
          value={loading ? '--' : `${remainingLikes}/${DAILY_LIKE_SWIPE_LIMIT}`}
        />
        <QuotaPill
          active={activeSet.has('dislike')}
          icon="arrow-left-thin"
          iconColor={theme.colors.dangerText}
          label={t('quota.dislike')}
          value={loading ? '--' : `${remainingDislikes}/${DAILY_DISLIKE_SWIPE_LIMIT}`}
        />
        <QuotaPill
          active={activeSet.has('undo')}
          icon="arrow-down-thin"
          iconColor={theme.colors.primarySoft}
          label={t('quota.undo')}
          value={loading ? '--' : `${remainingUndos}/${DAILY_UNDO_LIMIT}`}
        />
        <QuotaPill
          icon="timer-outline"
          iconColor={theme.colors.warning}
          label={t('quota.refresh')}
          value={loading ? '--:--:--' : formatRemainingTime(remainingMs)}
          align="right"
        />
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
}: {
  active?: boolean;
  align?: 'left' | 'right';
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  label: string;
  value: string;
}) {
  const resolvedIconColor = active ? iconColor : theme.colors.textSoft;

  return (
    <View style={[styles.pill, !active && styles.pillMuted, align === 'right' && styles.pillRight]}>
      <View style={[styles.labelRow, align === 'right' && styles.labelRowRight]}>
        <MaterialCommunityIcons accessible={false} name={icon} size={14} color={resolvedIconColor} />
        <Text style={[styles.pillLabel, !active && styles.pillTextMuted]}>{label}</Text>
      </View>
      <Text style={[styles.pillValue, !active && styles.pillTextMuted]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 30,
    elevation: 30,
  },
  card: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.glass,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cardCompact: {
    flexWrap: 'wrap',
  },
  pill: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    gap: 4,
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
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  pillValue: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
});
