import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import type { Movie } from '../../services/tmdb';
import { getLocalizedUserGenderLabel } from '../../shared/i18n/helpers';
import type { ApiUser } from '../../shared/types';
import { theme } from '../../shared/theme';
import { getCompatibilityStyle } from '../../shared/theme/compatibility';

interface UserMiniCardProps {
  user: ApiUser;
  score?: number;
  currentMovie?: Movie | null;
  concealed?: boolean;
  concealLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
}

export default function UserMiniCard({
  user,
  score,
  currentMovie,
  concealed = false,
  concealLabel = 'Premium',
  disabled = false,
  style,
  onPress,
}: UserMiniCardProps) {
  const { t } = useLocalization();
  const photo = user.photos.find((item) => item.trim().length > 0) ?? null;
  const scoreStyle = getCompatibilityStyle(score ?? 0);
  const showAge = user.showAgeOnProfile !== false && Boolean(user.age);
  const showGender = user.showGenderOnProfile !== false && Boolean(user.gender) && user.gender !== 'other';
  const movieTitle = currentMovie?.title || currentMovie?.name;
  const bioText = user.bio?.trim() || movieTitle || t('user.card.defaultBio');
  const genderLabel = showGender && user.gender ? getLocalizedUserGenderLabel(t, user.gender) : null;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.card, style, disabled && styles.cardDisabled, pressed && !disabled && styles.cardPressed]}
    >
      <View style={styles.photoWrap}>
        {photo ? (
          <View style={styles.photo}>
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              enforceEarlyResizing
              priority="normal"
              recyclingKey={`profile-mini:${user.id}:${photo}`}
            source={{ uri: photo }}
            blurRadius={concealed ? 22 : 0}
              style={styles.photoImage}
              transition={80}
            />
            <View style={styles.photoScrim} />
          </View>
        ) : (
          <View style={[styles.photo, styles.placeholder]}>
            <View style={styles.placeholderIconWrap}>
              <MaterialCommunityIcons name="account-outline" size={34} color={theme.colors.primarySoft} />
            </View>
          </View>
        )}

        {score != null ? (
          <View
            style={[
              styles.scoreBadge,
              concealed && styles.scoreBadgeConcealed,
              {
                backgroundColor: scoreStyle.bg,
                borderColor: scoreStyle.borderColor,
              },
            ]}
          >
            <Text style={[styles.scoreText, { color: scoreStyle.color }]}>%{score}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.body, concealed && styles.bodyConcealed]}>
        <View style={styles.identityRow}>
          {concealed ? <View style={styles.nameMask} /> : (
            <Text numberOfLines={1} style={styles.name}>
              {user.name}
            </Text>
          )}
        </View>

        {showAge || genderLabel ? (
          <View style={styles.metaRow}>
          {showAge && user.age ? (
            <View style={styles.ageChip}>
              <Text style={styles.ageText}>{user.age}</Text>
            </View>
          ) : null}

          {genderLabel ? (
            <View style={styles.genderChip}>
              <Text style={styles.genderText}>{genderLabel}</Text>
            </View>
          ) : null}
          </View>
        ) : null}

        {concealed ? <View style={styles.usernameMask} /> : (
          <Text numberOfLines={1} style={styles.username}>
            {user.username}
          </Text>
        )}

        {concealed ? (
          <View style={styles.bioMaskStack}>
            <View style={styles.bioMaskLong} />
            <View style={styles.bioMaskShort} />
          </View>
        ) : (
          <Text numberOfLines={2} style={styles.bio}>
            {bioText}
          </Text>
        )}

      </View>

      {concealed ? (
        <View pointerEvents="none" style={styles.concealedOverlay}>
          <View style={styles.concealedBadge}>
            <MaterialCommunityIcons name="crown-outline" size={16} color={theme.colors.primarySoft} />
            <Text style={styles.concealedBadgeText}>{concealLabel}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.986 }],
  },
  cardDisabled: {
    opacity: 0.98,
  },
  photoWrap: {
    position: 'relative',
    aspectRatio: 0.78,
    backgroundColor: theme.colors.surface,
  },
  photo: {
    flex: 1,
  },
  photoImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  photoScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: theme.alpha.black14,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  placeholderIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  scoreBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 52,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '900',
  },
  scoreBadgeConcealed: {
    opacity: 0.42,
  },
  body: {
    gap: 5,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 11,
  },
  bodyConcealed: {
    opacity: 0.46,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  name: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  nameMask: {
    width: '62%',
    height: 14,
    borderRadius: 999,
    backgroundColor: theme.alpha.white16,
  },
  ageChip: {
    minWidth: theme.layout.controlMinUnified,
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceStrong,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ageText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  genderChip: {
    borderRadius: 999,
    backgroundColor: theme.colors.surfaceStrong,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  username: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  usernameMask: {
    width: '58%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.alpha.white12,
  },
  bio: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '600',
  },
  bioMaskStack: {
    gap: 6,
    paddingTop: 2,
  },
  bioMaskLong: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.alpha.white12,
  },
  bioMaskShort: {
    width: '74%',
    height: 10,
    borderRadius: 999,
    backgroundColor: theme.alpha.white08,
  },
  concealedOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha.background12,
  },
  concealedBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.alpha.brand22,
    backgroundColor: theme.alpha.background92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  concealedBadgeText: {
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '900',
  },
});
