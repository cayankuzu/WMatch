import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../../context/LocalizationContext';
import { getLetterboxdDisplayText, getLetterboxdProfileUrl } from '../../../shared/config/externalLinks';
import { getLocalizedUserGenderLabel } from '../../../shared/i18n/helpers';
import { theme } from '../../../shared/theme';
import type { ProfileCardUser } from './types';

interface ProfileIdentitySectionProps {
  isOwnProfile: boolean;
  user: ProfileCardUser;
  onEditProfile?: () => void;
}

function ProfileIdentitySection({ isOwnProfile, user, onEditProfile }: ProfileIdentitySectionProps) {
  const { t } = useLocalization();
  const showAge = user.showAgeOnProfile !== false && Boolean(user.age);
  const showGender = user.showGenderOnProfile !== false && Boolean(user.gender) && user.gender !== 'other';
  const genderLabel = showGender && user.gender ? getLocalizedUserGenderLabel(t, user.gender) : null;
  const letterboxdUrl = getLetterboxdProfileUrl(user.letterboxd?.trim() ?? '');
  const letterboxdText = getLetterboxdDisplayText(letterboxdUrl, t('profile.card.letterboxdMissing'));

  return (
    <View style={styles.card}>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{user.name}</Text>
        {showAge && user.age ? (
          <View style={styles.ageChip}><Text style={styles.ageText}>{user.age}</Text></View>
        ) : null}
        {genderLabel ? (
          <View style={styles.genderChip}><Text style={styles.genderText}>{genderLabel}</Text></View>
        ) : null}
      </View>
      <Text style={styles.username}>{user.username}</Text>

      {letterboxdUrl || isOwnProfile ? (
        <View style={styles.linkRow}>
          <MaterialCommunityIcons
            name="link-variant"
            size={14}
            color={letterboxdUrl ? theme.colors.primarySoft : theme.colors.textSoft}
          />
          <Text style={styles.linkLabel}>Letterboxd:</Text>
          <Pressable
            accessibilityRole={letterboxdUrl ? 'link' : 'button'}
            disabled={!letterboxdUrl && !onEditProfile}
            onPress={() => letterboxdUrl ? void Linking.openURL(letterboxdUrl) : onEditProfile?.()}
            style={styles.linkValueWrap}
          >
            <Text numberOfLines={1} style={letterboxdUrl ? styles.letterboxd : styles.linkPlaceholder}>
              {letterboxdUrl ? letterboxdText : t('profile.card.letterboxdAdd')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}
    </View>
  );
}

export default memo(ProfileIdentitySection);

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.personCard,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    padding: 12,
    gap: 6,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name: { color: theme.colors.text, ...theme.typography.roles.screenTitle, letterSpacing: 0 },
  ageChip: {
    minWidth: 28,
    minHeight: 24,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
    borderWidth: 1,
    borderColor: theme.alpha.brand26,
  },
  ageText: { color: theme.colors.primarySoft, ...theme.typography.roles.meta, fontFamily: theme.fonts.semibold },
  genderChip: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  genderText: { color: theme.colors.text, ...theme.typography.roles.meta },
  username: { color: theme.colors.textMuted, ...theme.typography.roles.meta },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  linkLabel: { color: theme.colors.textMuted, ...theme.typography.roles.meta, flexShrink: 0 },
  linkValueWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.layout.controlMinUnified,
    justifyContent: 'center',
  },
  letterboxd: {
    color: theme.colors.primarySoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
    textDecorationLine: 'underline',
    flexShrink: 1,
  },
  linkPlaceholder: {
    flex: 1,
    color: theme.colors.textSoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
    flexShrink: 1,
  },
  bio: { color: theme.colors.text, ...theme.typography.roles.body, marginTop: 3 },
});
