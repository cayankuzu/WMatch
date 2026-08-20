import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { MAX_PROFILE_PHOTOS } from '../../../shared/constants';
import { theme } from '../../../shared/theme';
import AppImage from '../ui/AppImage';
import AuthLegalConsent from '../ui/AuthLegalConsent';

interface SignUpReviewProps {
  acceptedLegal: boolean;
  age: string;
  bio: string;
  genderLabel: string;
  legalError?: string;
  name: string;
  photo: string | null;
  photoCount: number;
  username: string;
  onToggleLegal: () => void;
}

function SignUpReview({
  acceptedLegal,
  age,
  bio,
  genderLabel,
  legalError,
  name,
  photo,
  photoCount,
  username,
  onToggleLegal,
}: SignUpReviewProps) {
  const { t } = useLocalization();

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        {photo ? (
          <AppImage
            contentFit="cover"
            fallbackIcon="account-outline"
            recyclingKey={photo}
            uri={photo}
            style={styles.photo}
          />
        ) : (
          <View style={styles.photoFallback}>
            <MaterialCommunityIcons name="account-outline" size={20} color={theme.colors.primarySoft} />
          </View>
        )}

        <View style={styles.body}>
          <Text numberOfLines={1} style={styles.name}>{name}</Text>
          <Text numberOfLines={1} style={styles.username}>{username}</Text>
          <Text numberOfLines={3} style={styles.bio}>{bio}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        <ReviewMetric label={t('common.age')} value={String(Number(age) || '-')} />
        <ReviewMetric label={t('common.gender')} value={genderLabel} />
        <ReviewMetric label={t('profile.edit.photos')} value={`${photoCount}/${MAX_PROFILE_PHOTOS}`} />
      </View>

      <AuthLegalConsent checked={acceptedLegal} onToggle={onToggleLegal} />
      {legalError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{legalError}</Text> : null}
    </View>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  card: {
    minHeight: 96,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  photo: {
    width: 72,
    height: 80,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceStrong,
  },
  photoFallback: {
    width: 72,
    height: 80,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  body: {
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minWidth: 0,
  },
  name: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontFamily: theme.fonts.extraBold,
  },
  username: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.body,
    fontFamily: theme.fonts.bold,
  },
  bio: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 17,
  },
  grid: {
    flexDirection: 'row',
    gap: 6,
  },
  metric: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  metricLabel: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  metricValue: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontFamily: theme.fonts.extraBold,
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.caption,
    lineHeight: 17,
    fontFamily: theme.fonts.semibold,
  },
});

export default memo(SignUpReview);
