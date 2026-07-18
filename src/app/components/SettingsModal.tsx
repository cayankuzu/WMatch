import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { TMDB_ATTRIBUTION_URL } from '../../shared/config/externalLinks';
import { getPrivacyPolicyUrl, getTermsOfUseUrl } from '../../shared/config/publicWeb';
import { theme } from '../../shared/theme';
import BlockedUsersModal from './BlockedUsersModal';
import ResetPasswordModal from './ResetPasswordModal';
import AppModal from './ui/AppModal';
import AccessibleModal from './ui/AccessibleModal';

interface SettingsModalProps {
  showAgeOnProfile: boolean;
  showGenderOnProfile: boolean;
  onClose: () => void;
  onEditProfile: () => void;
  onOpenFilters: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
  onToggleShowAgeOnProfile: (value: boolean) => Promise<void>;
  onToggleShowGenderOnProfile: (value: boolean) => Promise<void>;
}

type SettingsScreen = 'root' | 'profile';

export default function SettingsModal({
  showAgeOnProfile,
  showGenderOnProfile,
  onClose,
  onEditProfile,
  onOpenFilters,
  onDeleteAccount,
  onLogout,
  onToggleShowAgeOnProfile,
  onToggleShowGenderOnProfile,
}: SettingsModalProps) {
  const { t } = useLocalization();
  const [showBlockedUsers, setShowBlockedUsers] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showAboutCredits, setShowAboutCredits] = useState(false);
  const [activeScreen, setActiveScreen] = useState<SettingsScreen>('root');
  const [savingAgeVisibility, setSavingAgeVisibility] = useState(false);
  const [savingGenderVisibility, setSavingGenderVisibility] = useState(false);

  const handleClose = () => {
    setActiveScreen('root');
    onClose();
  };

  const confirmDelete = () => {
    Alert.alert(t('settings.delete.title'), t('settings.delete.description'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          handleClose();
          onDeleteAccount();
        },
      },
    ]);
  };

  const confirmLogout = () => {
    Alert.alert(t('settings.logout.title'), t('settings.logout.description'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logout.confirm'),
        onPress: () => {
          handleClose();
          onLogout();
        },
      },
    ]);
  };

  const openExternalLink = async (url: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);

      if (!canOpen) {
        throw new Error('Unsupported URL');
      }

      await Linking.openURL(url);
    } catch {
      Alert.alert(t('auth.legal.linkErrorTitle'), t('auth.legal.linkErrorDescription'));
    }
  };

  const handleAgeVisibilityChange = async (value: boolean) => {
    if (savingAgeVisibility) {
      return;
    }

    setSavingAgeVisibility(true);

    try {
      await onToggleShowAgeOnProfile(value);
    } catch (error) {
      Alert.alert(
        t('settings.error.saveFailed'),
        error instanceof Error ? error.message : t('common.retry'),
      );
    } finally {
      setSavingAgeVisibility(false);
    }
  };

  const handleGenderVisibilityChange = async (value: boolean) => {
    if (savingGenderVisibility) {
      return;
    }

    setSavingGenderVisibility(true);

    try {
      await onToggleShowGenderOnProfile(value);
    } catch (error) {
      Alert.alert(
        t('settings.error.saveFailed'),
        error instanceof Error ? error.message : t('common.retry'),
      );
    } finally {
      setSavingGenderVisibility(false);
    }
  };

  return (
    <AccessibleModal transparent visible animationType="slide" onRequestClose={handleClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <Pressable accessible={false} onPress={handleClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerSide}>
              {activeScreen === 'profile' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => setActiveScreen('root')} style={styles.headerButton}>
                  <MaterialCommunityIcons name="chevron-left" size={20} color={theme.colors.text} />
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.title}>{activeScreen === 'root' ? t('settings.title') : t('settings.profileTitle')}</Text>

            <View style={styles.headerSide}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={handleClose} style={styles.headerButton}>
                <MaterialCommunityIcons name="close" size={22} color={theme.colors.text} />
              </Pressable>
            </View>
          </View>

          {activeScreen === 'root' ? (
            <View style={styles.list}>
              <SettingRow
                icon="account-edit-outline"
                title={t('settings.row.editProfile.title')}
                description={t('settings.row.editProfile.description')}
                onPress={onEditProfile}
              />
              <SettingRow
                icon="tune-variant"
                title={t('settings.row.filters.title')}
                description={t('settings.row.filters.description')}
                onPress={() => {
                  handleClose();
                  onOpenFilters();
                }}
              />
              <SettingRow
                icon="account-cog-outline"
                title={t('settings.row.profile.title')}
                description={t('settings.row.profile.description')}
                onPress={() => setActiveScreen('profile')}
              />
              <SettingRow
                icon="key-outline"
                title={t('settings.row.password.title')}
                description={t('settings.row.password.description')}
                onPress={() => setShowResetPassword(true)}
              />
              <SettingRow
                icon="block-helper"
                title={t('settings.row.blocked.title')}
                description={t('settings.row.blocked.description')}
                onPress={() => setShowBlockedUsers(true)}
              />
              <SettingRow
                icon="information-outline"
                title={t('settings.row.about.title')}
                description={t('settings.row.about.description')}
                onPress={() => setShowAboutCredits(true)}
              />
              <SettingRow
                icon="logout"
                title={t('settings.row.logout.title')}
                description={t('settings.row.logout.description')}
                onPress={confirmLogout}
              />
              <SettingRow
                icon="trash-can-outline"
                title={t('settings.row.delete.title')}
                description={t('settings.row.delete.description')}
                danger
                onPress={confirmDelete}
              />
            </View>
          ) : (
            <View style={styles.profilePanel}>
              <View style={styles.profileCard}>
                <ProfileToggleRow
                  icon="calendar-account-outline"
                  title={t('settings.toggle.age.title')}
                  description={t('settings.toggle.age.description')}
                  saving={savingAgeVisibility}
                  value={showAgeOnProfile}
                  onChange={handleAgeVisibilityChange}
                />
                <View style={styles.divider} />
                <ProfileToggleRow
                  icon="account-star-outline"
                  title={t('settings.toggle.gender.title')}
                  description={t('settings.toggle.gender.description')}
                  saving={savingGenderVisibility}
                  value={showGenderOnProfile}
                  onChange={handleGenderVisibilityChange}
                />
              </View>
            </View>
          )}
        </SafeAreaView>

        {showResetPassword ? <ResetPasswordModal onClose={() => setShowResetPassword(false)} /> : null}
        {showBlockedUsers ? <BlockedUsersModal onClose={() => setShowBlockedUsers(false)} /> : null}
        <AppModal
          visible={showAboutCredits}
          title={t('settings.about.title')}
          presentation="sheet"
          scrollable
          onClose={() => setShowAboutCredits(false)}
        >
          <View style={styles.aboutContent}>
            <View style={styles.aboutSection}>
              <Text style={styles.aboutHeading}>{t('settings.about.product.title')}</Text>
              <Text style={styles.aboutText}>{t('settings.about.product.description')}</Text>
            </View>

            <View style={[styles.aboutSection, styles.aboutSectionDivider]}>
              <Text style={styles.aboutHeading}>{t('settings.about.legal.title')}</Text>
              <AboutLinkRow
                label={t('settings.about.legal.privacy')}
                onPress={() => void openExternalLink(getPrivacyPolicyUrl())}
              />
              <AboutLinkRow
                label={t('settings.about.legal.terms')}
                onPress={() => void openExternalLink(getTermsOfUseUrl())}
              />
            </View>

            <View style={[styles.aboutSection, styles.aboutSectionDivider]}>
              <Text style={styles.aboutHeading}>{t('settings.about.tmdb.title')}</Text>
              <Text style={styles.aboutText}>{t('settings.about.tmdb.attribution')}</Text>
              <AboutLinkRow
                label={t('settings.about.tmdb.link')}
                onPress={() => void openExternalLink(TMDB_ATTRIBUTION_URL)}
              />
            </View>
          </View>
        </AppModal>
      </View>
    </AccessibleModal>
  );
}

function AboutLinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.aboutLinkRow, pressed && styles.rowPressed]}
    >
      <Text style={styles.aboutLinkText}>{label}</Text>
      <MaterialCommunityIcons name="open-in-new" size={18} color={theme.colors.primarySoft} />
    </Pressable>
  );
}

function ProfileToggleRow({
  description,
  icon,
  onChange,
  saving,
  title,
  value,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description: string;
  value: boolean;
  saving: boolean;
  onChange: (value: boolean) => Promise<void>;
}) {
  return (
    <View style={styles.profileRow}>
      <View style={styles.profileIconWrap}>
        <MaterialCommunityIcons name={icon} size={18} color={theme.colors.primarySoft} />
      </View>

      <View style={styles.profileTextWrap}>
        <Text style={styles.profileTitle}>{title}</Text>
        <Text style={styles.profileDescription}>{description}</Text>
      </View>

      {saving ? (
        <ActivityIndicator color={theme.colors.primarySoft} />
      ) : (
        <Switch
          value={value}
          onValueChange={(nextValue) => void onChange(nextValue)}
          trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primary }}
          thumbColor={theme.colors.white}
        />
      )}
    </View>
  );
}

interface SettingRowProps {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  description: string;
  danger?: boolean;
  onPress: () => void;
}

function SettingRow({ icon, title, description, danger = false, onPress }: SettingRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.iconWrap, danger && styles.iconWrapDanger]}>
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color={danger ? theme.colors.dangerText : theme.colors.primarySoft}
        />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]}>{title}</Text>
        <Text style={styles.rowDescription}>{description}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={theme.colors.textSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.scrim,
  },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: theme.colors.backgroundElevated,
    paddingTop: 10,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    alignSelf: 'center',
    backgroundColor: theme.colors.borderStrong,
    marginBottom: 8,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerSide: {
    width: theme.layout.controlMinUnified,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontWeight: '900',
  },
  list: {
    padding: 14,
    gap: 8,
  },
  row: {
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  rowPressed: {
    opacity: 0.85,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  iconWrapDanger: {
    backgroundColor: theme.colors.dangerSurface,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  rowTitleDanger: {
    color: theme.colors.dangerText,
  },
  rowDescription: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '600',
  },
  profilePanel: {
    padding: 14,
  },
  profileCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 14,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  profileTextWrap: {
    flex: 1,
    gap: 3,
  },
  profileTitle: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  profileDescription: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
  },
  aboutContent: {
    gap: 16,
  },
  aboutSection: {
    gap: 10,
  },
  aboutSectionDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 16,
  },
  aboutHeading: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.label.fontSize,
    lineHeight: theme.typography.roles.label.lineHeight,
    fontWeight: '900',
  },
  aboutText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.body.fontSize,
    lineHeight: theme.typography.roles.body.lineHeight,
    fontWeight: '600',
  },
  aboutLinkRow: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
  },
  aboutLinkText: {
    flex: 1,
    color: theme.colors.primarySoft,
    fontSize: theme.typography.roles.label.fontSize,
    lineHeight: theme.typography.roles.label.lineHeight,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 14,
  },
});
