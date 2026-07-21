import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import type { ViewerPreview } from '../../shared/types';
import { theme } from '../../shared/theme';
import AppImage from './ui/AppImage';

interface ViewerCountProps {
  totalCount: number;
  viewerProfiles: ViewerPreview[];
}

const MAX_AVATARS_WITH_LABEL = 2;

function ViewerCount({ totalCount, viewerProfiles }: ViewerCountProps) {
  const { t } = useLocalization();
  const shouldCollapse = totalCount > MAX_AVATARS_WITH_LABEL;
  const visibleProfiles = viewerProfiles.slice(0, MAX_AVATARS_WITH_LABEL);
  const overflowCount = shouldCollapse ? Math.max(totalCount - visibleProfiles.length, 0) : 0;

  return (
    <View
      accessible
      accessibilityLabel={t('viewer.count.label', { count: totalCount })}
      style={styles.container}
    >
      <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.avatarStack}>
        {visibleProfiles.map((viewer, index) => (
          <View
            key={viewer.id}
            style={[
              styles.avatarShell,
              index > 0 && styles.avatarOverlap,
              { zIndex: visibleProfiles.length - index + (overflowCount > 0 ? 1 : 0) },
            ]}
          >
            {viewer.photo ? (
              <AppImage
                contentFit="cover"
                fallbackIcon="account-outline"
                recyclingKey={viewer.photo}
                uri={viewer.photo}
                style={styles.avatar}
                transition={theme.motion.fast}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{viewer.name.trim().charAt(0).toUpperCase() || '?'}</Text>
              </View>
            )}
          </View>
        ))}

        {overflowCount > 0 ? (
          <View style={[styles.avatarShell, styles.avatarOverlap, styles.countBadge]}>
            <Text style={styles.countBadgeText}>+{overflowCount}</Text>
          </View>
        ) : null}
      </View>

      {!shouldCollapse ? <Text style={styles.label}>{t('viewer.count.label', { count: totalCount })}</Text> : null}
    </View>
  );
}

export default memo(ViewerCount);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarShell: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.pill,
    borderWidth: 2,
    borderColor: theme.colors.surface,
    overflow: 'hidden',
    backgroundColor: theme.colors.primarySurface,
  },
  avatarOverlap: {
    marginLeft: -10,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primaryStrong,
  },
  avatarInitial: {
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  countBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
  },
  countBadgeText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.micro.fontSize,
    lineHeight: theme.typography.roles.micro.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.medium,
    marginLeft: 8,
  },
});
