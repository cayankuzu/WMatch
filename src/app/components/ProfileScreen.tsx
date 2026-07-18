import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useLocalization } from '../../context/LocalizationContext';
import { requestForegroundLocation } from '../../services/location';
import type { Movie } from '../../services/tmdb';
import { hasActiveDistanceFilter, normalizeDiscoveryPreferences } from '../../shared/utils/discovery';
import { theme } from '../../shared/theme';
import DiscoveryFiltersModal from './DiscoveryFiltersModal';
import EditProfileModal from './EditProfileModal';
import LoadingScreen from './LoadingScreen';
import ProfileCard from './ProfileCard';
import SettingsModal from './SettingsModal';
import DataWarningBanner from './ui/DataWarningBanner';

interface ProfileScreenProps {
  onMovieClick: (movie: Movie) => void;
}

export default function ProfileScreen({ onMovieClick }: ProfileScreenProps) {
  const { t } = useLocalization();
  const { favorites, watched, libraryLoading, libraryError } = useApp();
  const { user, logout, refreshUser, updateProfile, deleteAccount, checkAvailability } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savingFilters, setSavingFilters] = useState(false);

  if (!user) {
    return <LoadingScreen message={t('profile.loading')} />;
  }

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await refreshUser();
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
    } catch (error) {
      Alert.alert(
        t('profile.error.deleteFailedTitle'),
        error instanceof Error ? error.message : t('common.retry'),
      );
    }
  };

  const handleSaveFilters = async (nextValue: typeof user.discoveryPreferences) => {
    const normalizedPreferences = normalizeDiscoveryPreferences(nextValue);
    const wantsDistanceFilter = hasActiveDistanceFilter(normalizedPreferences);

    setSavingFilters(true);

    try {
      const locationPayload = wantsDistanceFilter
        ? await requestForegroundLocation().then((location) => ({
            latitude: location.latitude,
            longitude: location.longitude,
            locationUpdatedAt: location.timestamp,
          }))
        : {};

      await updateProfile({
        ...locationPayload,
        discoveryPreferences: normalizedPreferences,
      });
      setShowFilters(false);
    } catch (error) {
      Alert.alert(
        t('profile.error.filtersFailedTitle'),
        error instanceof Error ? error.message : t('common.retry'),
      );
    } finally {
      setSavingFilters(false);
    }
  };

  return (
    <View style={styles.container}>
      <ProfileCard
        user={user}
        favorites={favorites}
        watched={watched}
        libraryLoading={libraryLoading}
        beforeCompatibilitySection={libraryError ? (
          <DataWarningBanner
            title={t('data.error.title')}
            description={libraryError === 'data.error.generic' ? t('data.error.generic') : libraryError}
            actionLabel={t('data.action.retry')}
            onAction={() => void handleRefresh()}
          />
        ) : null}
        onMovieClick={onMovieClick}
        isOwnProfile
        onHeaderRightPress={() => setShowSettings(true)}
        headerRightIcon="cog-outline"
        refreshing={refreshing}
        onRefresh={() => void handleRefresh()}
      />

      {showSettings ? (
        <SettingsModal
          showAgeOnProfile={user.showAgeOnProfile !== false}
          showGenderOnProfile={user.showGenderOnProfile !== false}
          onClose={() => setShowSettings(false)}
          onEditProfile={() => {
            setShowSettings(false);
            setShowEditProfile(true);
          }}
          onOpenFilters={() => setShowFilters(true)}
          onDeleteAccount={handleDeleteAccount}
          onLogout={() => void logout()}
          onToggleShowAgeOnProfile={(value) => updateProfile({ showAgeOnProfile: value })}
          onToggleShowGenderOnProfile={(value) => updateProfile({ showGenderOnProfile: value })}
        />
      ) : null}

      {showEditProfile ? (
        <EditProfileModal
          onClose={() => setShowEditProfile(false)}
          currentUserId={user.id}
          currentPhotos={user.photos}
          currentName={user.name}
          currentAge={user.age}
          currentEmail={user.email}
          currentGender={user.gender}
          currentUsername={user.username}
          currentBio={user.bio}
          currentLetterboxd={user.letterboxd}
          onCheckAvailability={checkAvailability}
          onSave={(data) => updateProfile(data)}
        />
      ) : null}

      {showFilters ? (
        <DiscoveryFiltersModal
          value={user.discoveryPreferences}
          locationReady={Boolean(user.locationUpdatedAt)}
          saving={savingFilters}
          onClose={() => setShowFilters(false)}
          onSave={handleSaveFilters}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});
