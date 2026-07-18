import { useCallback, useEffect, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { getBlockedUsers, unblockUser, type ApiUser } from '../../services/api';
import { theme } from '../../shared/theme';
import AppButton from './ui/AppButton';
import AccessibleModal from './ui/AccessibleModal';

interface BlockedUsersModalProps {
  onClose: () => void;
}

function Avatar({ user }: { user: ApiUser }) {
  const photo = user.photos.find((item) => item.trim().length > 0) ?? null;

  if (photo) {
    return (
      <Image
        accessible={false}
        cachePolicy="memory-disk"
        contentFit="cover"
        recyclingKey={photo}
        source={{ uri: photo }}
        style={styles.avatar}
        transition={120}
      />
    );
  }

  return (
    <View accessible={false} style={[styles.avatar, styles.avatarFallback]}>
      <MaterialCommunityIcons accessible={false} name="account-outline" size={22} color={theme.colors.primarySoft} />
    </View>
  );
}

export default function BlockedUsersModal({ onClose }: BlockedUsersModalProps) {
  const { t } = useLocalization();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const loadBlockedUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const data = await getBlockedUsers();
      setUsers(data);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('data.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadBlockedUsers();
  }, [loadBlockedUsers]);


  const handleUnblock = (user: ApiUser) => {
    Alert.alert(t('blocked.unblock.confirmTitle'), t('blocked.unblock.confirmDescription', { name: user.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        onPress: async () => {
          setBusyUserId(user.id);
          setUsers((current) => current.filter((item) => item.id !== user.id));

          try {
            await unblockUser(user.id);
          } catch (error) {
            setUsers((current) => [user, ...current.filter((item) => item.id !== user.id)]);
            Alert.alert(
              t('blocked.unblock.errorTitle'),
              error instanceof Error ? error.message : t('common.retry'),
            );
          } finally {
            setBusyUserId(null);
          }
        },
      },
    ]);
  };

  return (
    <AccessibleModal transparent visible animationType="slide" onRequestClose={onClose}>
      <View accessibilityViewIsModal importantForAccessibility="yes" style={styles.backdrop}>
        <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('blocked.title')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={styles.closeButton}>
              <MaterialCommunityIcons name="close" size={22} color={theme.colors.text} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={theme.colors.primarySoft} />
              <Text style={styles.loadingText}>{t('blocked.loading')}</Text>
            </View>
          ) : loadError ? (
            <View style={styles.empty}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="alert-circle-outline" size={28} color={theme.colors.dangerText} />
              </View>
              <Text style={styles.emptyTitle}>{t('data.error.title')}</Text>
              <Text style={styles.emptyText}>{loadError}</Text>
              <AppButton title={t('data.action.retry')} onPress={() => void loadBlockedUsers()} variant="secondary" />
            </View>
          ) : users.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="account-check-outline" size={28} color={theme.colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>{t('blocked.empty.title')}</Text>
              <Text style={styles.emptyText}>{t('blocked.empty.description')}</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {users.map((user) => {
                const busy = busyUserId === user.id;

                return (
                  <View key={user.id} style={styles.row}>
                    <Avatar user={user} />

                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={styles.name}>
                        {user.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.username}>
                        {user.username}
                      </Text>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${user.name} ${t('blocked.unblock.button')}`}
                      accessibilityState={{ disabled: busy, busy }}
                      disabled={busy}
                      onPress={() => handleUnblock(user)}
                      style={[styles.actionButton, busy && styles.actionButtonDisabled]}
                    >
                      <Text style={styles.actionButtonText}>
                        {busy ? t('common.waiting') : t('blocked.unblock.button')}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </AccessibleModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: theme.colors.scrim,
  },
  sheet: {
    minHeight: 280,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: theme.colors.backgroundElevated,
  },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.section,
    fontWeight: '900',
  },
  closeButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  loadingState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 34,
    gap: 10,
  },
  loadingText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  empty: {
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 34,
    gap: 8,
  },
  iconWrap: {
    width: 58,
    height: 58,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    marginBottom: 6,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  list: {
    padding: 16,
    gap: 10,
  },
  row: {
    minHeight: 68,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 999,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  username: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
  },
  actionButton: {
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
  actionButtonDisabled: {
    backgroundColor: theme.colors.disabledSurface,
  },
  actionButtonText: {
    color: theme.colors.primarySoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '900',
  },
});
