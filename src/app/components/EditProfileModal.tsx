import { useMemo, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AccessibleModal from './ui/AccessibleModal';

import { useLocalization } from '../../context/LocalizationContext';
import {
  MAX_AGE,
  MAX_BIO_LENGTH,
  MAX_LETTERBOXD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PROFILE_PHOTOS,
  MAX_USERNAME_LENGTH,
  MIN_AGE,
  MIN_PROFILE_PHOTOS,
} from '../../shared/constants';
import { getLocalizedDiscoveryGenderFilterLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import { PUBLIC_USER_GENDERS, type UserGender } from '../../shared/utils/discovery';
import { getUsernameValidationMessage, normalizeUsername, USERNAME_RULES_HINT } from '../../shared/utils/username';
import { validateAge, validateDisplayName, validateLetterboxd } from '../../shared/utils/validation';
import AppButton from './ui/AppButton';
import AppTextField from './ui/AppTextField';
import OptionChips from './ui/OptionChips';
import SortablePhotoGrid from './ui/SortablePhotoGrid';

interface EditProfileModalProps {
  onClose: () => void;
  currentUserId: string;
  currentPhotos: string[];
  currentName: string;
  currentAge: number;
  currentEmail: string;
  currentGender: UserGender;
  currentUsername: string;
  currentBio: string;
  currentLetterboxd?: string;
  onCheckAvailability: (payload: {
    email?: string;
    username?: string;
    currentUserId?: string;
  }) => Promise<{
    emailAvailable: boolean;
    usernameAvailable: boolean;
    normalizedUsername?: string;
    emailMessage?: string;
    usernameMessage?: string;
  }>;
  onSave: (data: {
    photos: string[];
    name: string;
    age: number;
    gender: UserGender;
    username: string;
    bio: string;
    letterboxd: string;
  }) => Promise<void> | void;
}

export default function EditProfileModal({
  onClose,
  currentUserId,
  currentPhotos,
  currentName,
  currentAge,
  currentEmail,
  currentGender,
  currentUsername,
  currentBio,
  currentLetterboxd = '',
  onCheckAvailability,
  onSave,
}: EditProfileModalProps) {
  const { t } = useLocalization();
  const [photos, setPhotos] = useState<string[]>(currentPhotos);
  const [name, setName] = useState(currentName);
  const [age, setAge] = useState(String(currentAge));
  const [gender, setGender] = useState<UserGender>(currentGender);
  const [username, setUsername] = useState(currentUsername);
  const [bio, setBio] = useState(currentBio);
  const [letterboxd, setLetterboxd] = useState(currentLetterboxd);
  const [saving, setSaving] = useState(false);
  const genderOptions = useMemo(
    () =>
      PUBLIC_USER_GENDERS.map((item) => ({
        value: item,
        label: getLocalizedDiscoveryGenderFilterLabel(t, item),
      })),
    [t],
  );
  const usernameValidationMessage = useMemo(
    () => (username.trim() ? getUsernameValidationMessage(username) : null),
    [username],
  );

  const pickPhoto = async () => {
    if (photos.length >= MAX_PROFILE_PHOTOS) {
      Alert.alert(
        t('profile.edit.error.photoLimitTitle'),
        t('profile.edit.error.photoLimitDescription', { count: MAX_PROFILE_PHOTOS }),
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t('profile.edit.error.photoPermissionTitle'),
        t('profile.edit.error.photoPermissionDescription'),
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      base64: false,
      exif: false,
      quality: 0.85,
    });

    const asset = result.canceled ? null : result.assets[0] ?? null;

    if (asset?.uri) {
      setPhotos((current) => [...current, asset.uri]);
    }
  };

  const handleSave = async () => {
    const normalizedUsername = normalizeUsername(username);
    const normalizedName = name.trim();
    const normalizedBio = bio.trim();
    const normalizedLetterboxd = letterboxd.trim();
    const parsedAge = Number(age);

    if (!normalizedName || !normalizedUsername.trim()) {
      Alert.alert(t('profile.edit.error.missingInfoTitle'), t('profile.edit.error.missingInfoDescription'));
      return;
    }

    const nameValidationMessage = validateDisplayName(normalizedName);
    if (nameValidationMessage) {
      Alert.alert(t('profile.edit.error.invalidNameTitle'), nameValidationMessage);
      return;
    }

    if (usernameValidationMessage) {
      Alert.alert(t('profile.edit.error.invalidUsernameTitle'), usernameValidationMessage);
      return;
    }

    const letterboxdValidationMessage = validateLetterboxd(normalizedLetterboxd);
    if (letterboxdValidationMessage) {
      Alert.alert(t('profile.edit.error.invalidLetterboxdTitle'), letterboxdValidationMessage);
      return;
    }

    const ageValidationMessage = validateAge(parsedAge);
    if (Number.isNaN(parsedAge) || ageValidationMessage) {
      Alert.alert(t('profile.edit.error.invalidAgeTitle'), ageValidationMessage ?? t('profile.edit.error.invalidAgeDescription', { min: MIN_AGE, max: MAX_AGE }));
      return;
    }

    if (photos.length < MIN_PROFILE_PHOTOS) {
      Alert.alert(
        t('profile.edit.error.minPhotosTitle'),
        t('profile.edit.error.minPhotosDescription', { count: MIN_PROFILE_PHOTOS }),
      );
      return;
    }

    const photosUnchanged =
      photos.length === currentPhotos.length &&
      photos.every((photo, index) => photo === currentPhotos[index]);
    const nothingChanged =
      photosUnchanged &&
      normalizedName === currentName.trim() &&
      parsedAge === currentAge &&
      gender === currentGender &&
      normalizedUsername === currentUsername.trim() &&
      normalizedBio === currentBio.trim() &&
      normalizedLetterboxd === currentLetterboxd.trim();

    if (nothingChanged) {
      Alert.alert(t('profile.edit.error.noChangesTitle'), t('profile.edit.error.noChangesDescription'));
      return;
    }

    setSaving(true);

    try {
      if (normalizedUsername !== currentUsername.trim()) {
        const availability = await onCheckAvailability({
          username: normalizedUsername,
          currentUserId,
        });

        if (!availability.usernameAvailable) {
          Alert.alert(
            t('profile.edit.error.usernameTakenTitle'),
            availability.usernameMessage ?? t('profile.edit.error.usernameTakenDescription'),
          );
          return;
        }
      }

      await onSave({
        photos,
        name: normalizedName,
        age: parsedAge,
        gender,
        username: normalizedUsername,
        bio: normalizedBio,
        letterboxd: normalizedLetterboxd,
      });
      onClose();
    } catch (error) {
      Alert.alert(
        t('profile.edit.error.saveFailedTitle'),
        error instanceof Error ? error.message : t('common.retry'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAgeChange = (value: string) => {
    const digitsOnly = value.replace(/\D+/g, '').slice(0, 2);

    if (!digitsOnly) {
      setAge('');
      return;
    }

    const numericValue = Math.min(Number(digitsOnly), MAX_AGE);
    setAge(String(numericValue));
  };

  return (
    <AccessibleModal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView accessibilityViewIsModal importantForAccessibility="yes" edges={['top', 'bottom']} style={styles.container}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onClose} style={styles.iconButton}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={theme.colors.text} />
          </Pressable>
          <Text style={styles.title}>{t('profile.edit.title')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.iconButton}>
            <MaterialCommunityIcons name="close" size={20} color={theme.colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('profile.edit.photos')}</Text>
              <Text style={styles.sectionMeta}>{photos.length}/{MAX_PROFILE_PHOTOS}</Text>
            </View>
            <Text style={styles.helper}>{t('profile.edit.photosHelper', { min: MIN_PROFILE_PHOTOS, max: MAX_PROFILE_PHOTOS })}</Text>

            <SortablePhotoGrid
              photos={photos}
              maxPhotos={MAX_PROFILE_PHOTOS}
              onChange={setPhotos}
              onAdd={() => void pickPhoto()}
              addLabel={t('photoGrid.add')}
            />
          </View>

          <View style={styles.section}>
            <AppTextField
              label={t('common.email')}
              value={currentEmail}
              onChangeText={() => {}}
              editable={false}
              leftIcon={<MaterialCommunityIcons name="email-outline" size={17} color={theme.colors.textSoft} />}
            />
            <AppTextField
              label={t('common.age')}
              value={age}
              onChangeText={handleAgeChange}
              keyboardType="number-pad"
              leftIcon={<MaterialCommunityIcons name="calendar-outline" size={17} color={theme.colors.textSoft} />}
            />
            <AppTextField
              label={t('common.name')}
              value={name}
              onChangeText={setName}
              placeholder={t('profile.edit.field.namePlaceholder')}
              maxLength={MAX_NAME_LENGTH}
              autoCapitalize="words"
              leftIcon={<MaterialCommunityIcons name="account-outline" size={17} color={theme.colors.textSoft} />}
            />

            <View style={styles.inlineSection}>
              <Text style={styles.inlineLabel}>{t('common.gender')}</Text>
              <OptionChips<UserGender> options={genderOptions} value={gender} onChange={setGender} />
            </View>

            <AppTextField
              label={t('common.username')}
              value={username}
              onChangeText={setUsername}
              placeholder={t('profile.edit.field.usernamePlaceholder')}
              maxLength={MAX_USERNAME_LENGTH + 1}
              hint={!usernameValidationMessage ? USERNAME_RULES_HINT : undefined}
              errorText={usernameValidationMessage ?? undefined}
              leftIcon={<MaterialCommunityIcons name="at" size={17} color={theme.colors.textSoft} />}
            />
            <AppTextField
              label={t('common.about')}
              value={bio}
              onChangeText={setBio}
              placeholder={t('profile.edit.field.bioPlaceholder')}
              multiline
              maxLength={MAX_BIO_LENGTH}
              autoCapitalize="sentences"
              leftIcon={<MaterialCommunityIcons name="message-text-outline" size={17} color={theme.colors.textSoft} />}
            />
            <Text style={styles.count}>{bio.length}/{MAX_BIO_LENGTH}</Text>
            <AppTextField
              label={t('common.letterboxd')}
              value={letterboxd}
              onChangeText={setLetterboxd}
              placeholder="letterboxd.com/sinefili34"
              maxLength={MAX_LETTERBOXD_LENGTH}
              leftIcon={<MaterialCommunityIcons name="link-variant" size={17} color={theme.colors.textSoft} />}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <AppButton title={t('common.save')} onPress={() => void handleSave()} loading={saving} />
        </View>
      </SafeAreaView>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  iconButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontWeight: '900',
  },
  content: {
    padding: 14,
    gap: 16,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontWeight: '900',
  },
  sectionMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    fontWeight: '800',
  },
  helper: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    lineHeight: 17,
  },
  inlineSection: {
    gap: 8,
  },
  inlineLabel: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  count: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.caption,
    fontWeight: '700',
    textAlign: 'right',
    marginTop: -8,
  },
  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
});
