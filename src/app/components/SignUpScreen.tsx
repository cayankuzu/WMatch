import { useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

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
import { readSignupDraft, writeSignupDraft, type StoredSignupDraft } from '../../services/signupDraft';
import { getLocalizedUserGenderLabel } from '../../shared/i18n/helpers';
import { theme } from '../../shared/theme';
import {
  USER_GENDERS,
  type UserGender,
} from '../../shared/utils/discovery';
import { getUsernameValidationMessage, normalizeUsername, USERNAME_RULES_HINT } from '../../shared/utils/username';
import type { SignUpData } from '../../shared/types';
import { validateAge, validateDisplayName, validateLetterboxd, validatePassword } from '../../shared/utils/validation';
import AppButton from './ui/AppButton';
import AppTextField from './ui/AppTextField';
import AuthFooter from './ui/AuthFooter';
import AuthWordmark from './ui/AuthWordmark';
import OptionChips from './ui/OptionChips';
import Screen from './ui/Screen';
import SignUpProgress from './ui/SignUpProgress';
import SortablePhotoGrid from './ui/SortablePhotoGrid';
import PasswordStrength from './signup/PasswordStrength';
import SignUpReview from './signup/SignUpReview';

interface SignUpScreenProps {
  onSignUp: (userData: SignUpData) => Promise<void>;
  onCheckAvailability: (payload: {
    email?: string;
    username?: string;
  }) => Promise<{
    emailAvailable: boolean;
    usernameAvailable: boolean;
    normalizedUsername?: string;
    emailMessage?: string;
    usernameMessage?: string;
  }>;
  onBackToLogin: () => void;
}

const AVAILABILITY_DEBOUNCE_MS = 450;

type SignUpField =
  | 'email'
  | 'password'
  | 'name'
  | 'age'
  | 'gender'
  | 'username'
  | 'photos'
  | 'letterboxd'
  | 'legal';

const FIELD_OWNER_STEP: Record<SignUpField, number> = {
  email: 1,
  password: 1,
  name: 2,
  age: 2,
  gender: 2,
  username: 2,
  photos: 3,
  letterboxd: 3,
  legal: 4,
};

export default function SignUpScreen({
  onSignUp,
  onCheckAvailability,
  onBackToLogin,
}: SignUpScreenProps) {
  const { t } = useLocalization();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignUpField, string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [emailAvailabilityError, setEmailAvailabilityError] = useState<string | null>(null);
  const [usernameAvailabilityError, setUsernameAvailabilityError] = useState<string | null>(null);
  const draftLoadedRef = useRef(false);
  const availabilitySeqRef = useRef(0);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<UserGender | null>(null);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [letterboxd, setLetterboxd] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const draft = await readSignupDraft();
        if (!draft || !mounted) {
          return;
        }

        if (typeof draft.email === 'string') {
          setEmail(draft.email);
        }

        if (Array.isArray(draft.photos)) {
          setPhotos(draft.photos.filter((photo): photo is string => typeof photo === 'string'));
        }
      } catch (draftError) {
        console.warn('Signup draft could not be restored:', draftError);
      } finally {
        draftLoadedRef.current = true;
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!draftLoadedRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      const draft: StoredSignupDraft = {
        email: email.trim().toLowerCase(),
        photos,
        updatedAt: Date.now(),
      };

      void writeSignupDraft(draft).catch((draftError) => {
        console.warn('Signup draft could not be persisted:', draftError);
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [email, photos]);

  const genderOptions = useMemo(
    () =>
      USER_GENDERS.map((item) => ({
        value: item,
        label: getLocalizedUserGenderLabel(t, item),
      })),
    [t],
  );

  const usernameValidationMessage = useMemo(
    () => (username.trim() ? getUsernameValidationMessage(username) : null),
    [username],
  );

  const passwordChecks = useMemo(
    () => [
      {
        key: 'length',
        label: t('auth.signup.passwordStrength.length'),
        passed: password.length >= 8,
      },
      {
        key: 'letter',
        label: t('auth.signup.passwordStrength.letter'),
        passed: /[A-Za-z]/.test(password),
      },
      {
        key: 'numberOrSymbol',
        label: t('auth.signup.passwordStrength.numberOrSymbol'),
        passed: /[0-9!@#$%^&*(),.?":{}|<>_\-+=/\\[\];'`~]/.test(password),
      },
    ],
    [password, t],
  );
  const passwordStrengthScore = passwordChecks.filter((item) => item.passed).length;
  const passwordStrengthLabel =
    passwordStrengthScore >= 3
      ? t('auth.signup.passwordStrength.strong')
      : passwordStrengthScore >= 2
        ? t('auth.signup.passwordStrength.medium')
        : t('auth.signup.passwordStrength.weak');

  const clearFieldError = (field: SignUpField) => {
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const setFieldError = (field: SignUpField, message: string) => {
    setError('');
    setFieldErrors((current) => ({
      ...current,
      [field]: message,
    }));
    setStep(FIELD_OWNER_STEP[field]);
  };

  const clearStepFieldErrors = (fields: SignUpField[]) => {
    setFieldErrors((current) => {
      const next = { ...current };
      fields.forEach((field) => {
        delete next[field];
      });
      return next;
    });
  };

  useEffect(() => {
    if (step !== 1) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    setEmailAvailabilityError(null);

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return;
    }

    const requestSeq = availabilitySeqRef.current + 1;
    availabilitySeqRef.current = requestSeq;
    const timer = setTimeout(() => {
      setChecking(true);

      void onCheckAvailability({ email: normalizedEmail })
        .then((availability) => {
          if (availabilitySeqRef.current !== requestSeq) {
            return;
          }

          setEmailAvailabilityError(
            availability.emailAvailable
              ? null
              : availability.emailMessage ?? t('auth.signup.error.emailTaken'),
          );
        })
        .catch((caughtError) => {
          if (availabilitySeqRef.current !== requestSeq) {
            return;
          }

          setEmailAvailabilityError(
            caughtError instanceof Error ? caughtError.message : t('auth.signup.error.emailCheckFailed'),
          );
        })
        .finally(() => {
          if (availabilitySeqRef.current === requestSeq) {
            setChecking(false);
          }
        });
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [email, onCheckAvailability, step, t]);

  useEffect(() => {
    if (step !== 2) {
      return;
    }

    const normalizedUsername = normalizeUsername(username);
    setUsernameAvailabilityError(null);

    if (!normalizedUsername || usernameValidationMessage) {
      return;
    }

    const requestSeq = availabilitySeqRef.current + 1;
    availabilitySeqRef.current = requestSeq;
    const timer = setTimeout(() => {
      setChecking(true);

      void onCheckAvailability({ username: normalizedUsername })
        .then((availability) => {
          if (availabilitySeqRef.current !== requestSeq) {
            return;
          }

          setUsernameAvailabilityError(
            availability.usernameAvailable
              ? null
              : availability.usernameMessage ?? t('auth.signup.error.usernameTaken'),
          );
        })
        .catch((caughtError) => {
          if (availabilitySeqRef.current !== requestSeq) {
            return;
          }

          setUsernameAvailabilityError(
            caughtError instanceof Error ? caughtError.message : t('auth.signup.error.usernameCheckFailed'),
          );
        })
        .finally(() => {
          if (availabilitySeqRef.current === requestSeq) {
            setChecking(false);
          }
        });
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [onCheckAvailability, step, t, username, usernameValidationMessage]);

  const canContinue = useMemo(() => {
    if (step === 1) {
      return Boolean(
        email.trim() &&
          password &&
          !validatePassword(password) &&
          !emailAvailabilityError &&
          !fieldErrors.email &&
          !fieldErrors.password,
      );
    }
    if (step === 2) {
      return Boolean(
        name.trim() &&
          age.trim() &&
          username.trim() &&
          !usernameValidationMessage &&
          !usernameAvailabilityError &&
          gender != null &&
          !fieldErrors.name &&
          !fieldErrors.age &&
          !fieldErrors.gender &&
          !fieldErrors.username,
      );
    }
    if (step === 3) {
      return photos.length >= MIN_PROFILE_PHOTOS && !fieldErrors.photos && !fieldErrors.letterboxd;
    }
    return true;
  }, [
    age,
    email,
    emailAvailabilityError,
    fieldErrors.age,
    fieldErrors.email,
    fieldErrors.gender,
    fieldErrors.letterboxd,
    fieldErrors.name,
    fieldErrors.password,
    fieldErrors.photos,
    fieldErrors.username,
    gender,
    name,
    password,
    photos.length,
    step,
    username,
    usernameAvailabilityError,
    usernameValidationMessage,
  ]);

  const handleAgeChange = (value: string) => {
    const digitsOnly = value.replace(/\D+/g, '').slice(0, 2);

    if (!digitsOnly) {
      setAge('');
      return;
    }

    const numericValue = Math.min(Number(digitsOnly), MAX_AGE);
    setAge(String(numericValue));
  };

  const pickProfilePhoto = async () => {
    if (photos.length >= MAX_PROFILE_PHOTOS) {
      Alert.alert(
        t('auth.signup.error.photoLimitTitle'),
        t('auth.signup.error.photoLimitDescription', { count: MAX_PROFILE_PHOTOS }),
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t('auth.signup.error.photoPermissionTitle'),
        t('auth.signup.error.photoPermissionDescription'),
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
      clearFieldError('photos');
      setPhotos((current) => [...current, asset.uri]);
    }
  };

  const reviewName = name.trim() || t('auth.signup.preview.name');
  const reviewUsername = normalizeUsername(username) || t('auth.signup.preview.username');
  const reviewBio = bio.trim() || t('auth.signup.preview.bio');
  const reviewPhoto = photos.find((photo) => photo.trim().length > 0) ?? null;
  const reviewGenderLabel = gender ? getLocalizedUserGenderLabel(t, gender) : '-';

  const handleNext = async () => {
    if (checking || loading) {
      return;
    }

    setError('');
    clearStepFieldErrors(['email', 'password', 'name', 'age', 'gender', 'username', 'photos']);

    if (step === 1) {
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail) {
        setFieldError('email', t('auth.signup.error.emailRequired'));
        return;
      }

      const passwordValidationMessage = validatePassword(password);
      if (passwordValidationMessage) {
        setFieldError('password', passwordValidationMessage);
        return;
      }

      setChecking(true);

      try {
        const availability = await onCheckAvailability({ email: normalizedEmail });

        if (!availability.emailAvailable) {
          setFieldError('email', availability.emailMessage ?? t('auth.signup.error.emailTaken'));
          return;
        }
      } catch (caughtError) {
        setFieldError(
          'email',
          caughtError instanceof Error ? caughtError.message : t('auth.signup.error.emailCheckFailed'),
        );
        return;
      } finally {
        setChecking(false);
      }
    }

    if (step === 2) {
      if (!gender) {
        setFieldError('gender', t('auth.signup.error.genderRequired'));
        return;
      }

      const parsedAge = Number(age);
      const ageValidationMessage = validateAge(parsedAge);
      if (Number.isNaN(parsedAge) || ageValidationMessage) {
        setFieldError('age', ageValidationMessage ?? t('auth.signup.error.minAge', { age: MIN_AGE }));
        return;
      }

      const nameValidationMessage = validateDisplayName(name);
      if (nameValidationMessage) {
        setFieldError('name', nameValidationMessage);
        return;
      }

      setChecking(true);

      try {
        const usernameError = getUsernameValidationMessage(username);
        if (usernameError) {
          setFieldError('username', usernameError);
          return;
        }

        const availability = await onCheckAvailability({ username: normalizeUsername(username) });

        if (!availability.usernameAvailable) {
          setFieldError('username', availability.usernameMessage ?? t('auth.signup.error.usernameTaken'));
          return;
        }
      } catch (caughtError) {
        setFieldError(
          'username',
          caughtError instanceof Error ? caughtError.message : t('auth.signup.error.usernameCheckFailed'),
        );
        return;
      } finally {
        setChecking(false);
      }
    }

    if (step === 3 && photos.length < MIN_PROFILE_PHOTOS) {
      setFieldError('photos', t('auth.signup.error.minPhotos', { count: MIN_PROFILE_PHOTOS }));
      return;
    }

    setStep((current) => Math.min(current + 1, 4));
  };

  const handleSubmit = async () => {
    if (loading) {
      return;
    }

    setLoading(true);
    setError('');
    clearStepFieldErrors(['email', 'password', 'name', 'age', 'gender', 'username', 'photos', 'letterboxd', 'legal']);

    try {
      if (!acceptedLegal) {
        setFieldError('legal', t('auth.signup.error.legalRequired'));
        return;
      }

      const nameValidationMessage = validateDisplayName(name);
      if (nameValidationMessage) {
        setFieldError('name', nameValidationMessage);
        return;
      }

      const parsedAge = Number(age);
      const ageValidationMessage = validateAge(parsedAge);
      if (ageValidationMessage) {
        setFieldError('age', ageValidationMessage);
        return;
      }

      if (!gender) {
        setFieldError('gender', t('auth.signup.error.genderRequired'));
        return;
      }

      const letterboxdValidationMessage = validateLetterboxd(letterboxd);
      if (letterboxdValidationMessage) {
        setFieldError('letterboxd', letterboxdValidationMessage);
        return;
      }

      const usernameError = getUsernameValidationMessage(username);
      if (usernameError) {
        setFieldError('username', usernameError);
        return;
      }

      const availability = await onCheckAvailability({
        email: email.trim().toLowerCase(),
        username: normalizeUsername(username),
      });

      if (!availability.emailAvailable) {
        setFieldError('email', availability.emailMessage ?? t('auth.signup.error.emailTaken'));
        return;
      }

      if (!availability.usernameAvailable) {
        setFieldError('username', availability.usernameMessage ?? t('auth.signup.error.usernameTaken'));
        return;
      }

      await onSignUp({
        email: email.trim().toLowerCase(),
        password,
        name: name.trim(),
        age: parsedAge,
        gender,
        username: normalizeUsername(username),
        bio: bio.trim(),
        letterboxd: letterboxd.trim(),
        photos,
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t('auth.signup.error.submitFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.container}>
      <View style={styles.hero}>
        <AuthWordmark />
      </View>

      <View style={styles.lockedSection}>
        <Pressable
          accessibilityRole="button"
          onPress={() => (step === 1 ? onBackToLogin() : setStep((current) => current - 1))}
        >
          <View style={styles.backRow}>
            <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.text} />
            <Text style={styles.backText}>{t('auth.signup.back')}</Text>
          </View>
        </Pressable>

        <SignUpProgress step={step} />

        <View style={styles.card}>
          <Text style={styles.title}>
            {step === 1 && t('auth.signup.stepTitle.account')}
            {step === 2 && t('auth.signup.stepTitle.identity')}
            {step === 3 && t('auth.signup.stepTitle.profile')}
            {step === 4 && t('auth.signup.stepTitle.review')}
          </Text>
          <Text style={styles.subtitle}>{t('auth.signup.stepCounter', { step })}</Text>

          {step === 1 ? (
            <View style={styles.formFields}>
              <AppTextField
                label={t('common.email')}
                value={email}
                onChangeText={(value) => {
                  clearFieldError('email');
                  setEmail(value.replace(/\s+/g, '').toLowerCase());
                }}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="next"
                placeholder="ornek@email.com"
                errorText={fieldErrors.email ?? emailAvailabilityError ?? undefined}
                leftIcon={<MaterialCommunityIcons name="email-outline" size={17} color={theme.colors.textSoft} />}
              />
              <AppTextField
                label={t('common.password')}
                value={password}
                onChangeText={(value) => {
                  clearFieldError('password');
                  setPassword(value);
                }}
                secureTextEntry={!showPassword}
                autoComplete="new-password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={() => void handleNext()}
                placeholder="En az 8 karakter"
                errorText={fieldErrors.password}
                leftIcon={<MaterialCommunityIcons name="lock-outline" size={17} color={theme.colors.textSoft} />}
                rightIcon={
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={17}
                    color={theme.colors.textSoft}
                  />
                }
                onRightIconPress={() => setShowPassword((current) => !current)}
              />
              {password ? (
                <PasswordStrength checks={passwordChecks} label={passwordStrengthLabel} score={passwordStrengthScore} />
              ) : null}
            </View>
          ) : null}

          {step === 2 ? (
            <View style={styles.formFields}>
              <AppTextField
                label={t('common.name')}
                value={name}
                onChangeText={(value) => {
                  clearFieldError('name');
                  setName(value);
                }}
                placeholder={t('auth.signup.placeholder.fullName')}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="name"
                textContentType="name"
                leftIcon={<MaterialCommunityIcons name="account-outline" size={17} color={theme.colors.textSoft} />}
                autoCapitalize="words"
                errorText={fieldErrors.name}
              />
              <AppTextField
                label={t('common.age')}
                value={age}
                onChangeText={(value) => {
                  clearFieldError('age');
                  handleAgeChange(value);
                }}
                placeholder="18"
                keyboardType="number-pad"
                maxLength={2}
                leftIcon={<MaterialCommunityIcons name="calendar-outline" size={17} color={theme.colors.textSoft} />}
                errorText={fieldErrors.age}
              />
              <View style={styles.inlineSection}>
                <Text style={styles.inlineLabel}>{t('common.gender')}</Text>
                <OptionChips<UserGender>
                  options={genderOptions}
                  value={gender}
                  onChange={(value) => {
                    clearFieldError('gender');
                    setGender(value);
                  }}
                />
                {fieldErrors.gender ? (
                  <Text accessibilityLiveRegion="polite" style={styles.fieldErrorText}>{fieldErrors.gender}</Text>
                ) : null}
              </View>
              <AppTextField
                label={t('common.username')}
                value={username}
                onChangeText={(value) => {
                  clearFieldError('username');
                  setUsername(value);
                }}
                placeholder={t('profile.edit.field.usernamePlaceholder')}
                maxLength={MAX_USERNAME_LENGTH + 1}
                autoComplete="username"
                textContentType="username"
                hint={!usernameValidationMessage && !usernameAvailabilityError ? USERNAME_RULES_HINT : undefined}
                errorText={fieldErrors.username ?? usernameValidationMessage ?? usernameAvailabilityError ?? undefined}
                leftIcon={<MaterialCommunityIcons name="at" size={17} color={theme.colors.textSoft} />}
              />
            </View>
          ) : null}

          {step === 3 ? (
            <View style={styles.formFields}>
              <Text style={styles.helperText}>{t('auth.signup.helper.photoOrder')}</Text>
              <SortablePhotoGrid
                photos={photos}
                maxPhotos={MAX_PROFILE_PHOTOS}
                onChange={(nextPhotos) => {
                  clearFieldError('photos');
                  setPhotos(nextPhotos);
                }}
                onAdd={() => void pickProfilePhoto()}
                addLabel={t('photoGrid.add')}
              />
              {fieldErrors.photos ? (
                <Text accessibilityLiveRegion="polite" style={styles.fieldErrorText}>{fieldErrors.photos}</Text>
              ) : null}
              <AppTextField
                label={t('common.about')}
                value={bio}
                onChangeText={setBio}
                placeholder={t('auth.signup.placeholder.bio')}
                multiline
                maxLength={MAX_BIO_LENGTH}
                leftIcon={<MaterialCommunityIcons name="message-text-outline" size={17} color={theme.colors.textSoft} />}
                autoCapitalize="sentences"
              />
              <Text style={styles.characterCount}>{bio.length}/{MAX_BIO_LENGTH}</Text>
              <AppTextField
                label={t('common.letterboxd')}
                value={letterboxd}
                onChangeText={(value) => {
                  clearFieldError('letterboxd');
                  setLetterboxd(value);
                }}
                placeholder="letterboxd.com/sinefili34"
                maxLength={MAX_LETTERBOXD_LENGTH}
                autoComplete="url"
                keyboardType="url"
                leftIcon={<MaterialCommunityIcons name="link-variant" size={17} color={theme.colors.textSoft} />}
                errorText={fieldErrors.letterboxd}
              />
            </View>
          ) : null}

          {step === 4 ? (
            <SignUpReview
              acceptedLegal={acceptedLegal}
              age={age}
              bio={reviewBio}
              genderLabel={reviewGenderLabel}
              legalError={fieldErrors.legal}
              name={reviewName}
              photo={reviewPhoto}
              photoCount={photos.length}
              username={reviewUsername}
              onToggleLegal={() => {
                clearFieldError('legal');
                setAcceptedLegal((current) => !current);
              }}
            />
          ) : null}

          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

          {step < 4 ? (
            <AppButton
              title={t('auth.signup.continue')}
              onPress={() => void handleNext()}
              disabled={!canContinue || checking}
              loading={checking}
              rightIcon={<MaterialCommunityIcons name="arrow-right" size={15} color={theme.colors.white} />}
            />
          ) : (
            <AppButton
              title={t('auth.signup.submit')}
              onPress={() => void handleSubmit()}
              loading={loading}
              disabled={!acceptedLegal}
            />
          )}
        </View>
      </View>

      <AuthFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },
  hero: {
    alignItems: 'center',
    marginBottom: 4,
  },
  lockedSection: {
    gap: 8,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backText: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontFamily: theme.fonts.semibold,
  },
  card: {
    borderRadius: theme.radius.personCard,
    backgroundColor: theme.alpha.panel94,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 15,
    gap: 10,
  },
  title: {
    color: theme.colors.text,
    ...theme.typography.roles.screenTitle,
  },
  subtitle: {
    color: theme.colors.textMuted,
    ...theme.typography.roles.meta,
  },
  formFields: {
    gap: 8,
  },
  inlineSection: {
    gap: 6,
  },
  inlineLabel: {
    color: theme.colors.text,
    ...theme.typography.roles.control,
  },
  helperText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    lineHeight: 18,
  },
  characterCount: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.caption,
    textAlign: 'right',
    marginTop: -5,
  },
  fieldErrorText: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.caption,
    lineHeight: 17,
    fontFamily: theme.fonts.semibold,
  },
  error: {
    color: theme.colors.dangerText,
    fontSize: theme.typography.body,
    fontFamily: theme.fonts.semibold,
  },
});
