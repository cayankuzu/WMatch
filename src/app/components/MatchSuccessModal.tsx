import { useEffect } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { MATCH_LIKE_REWARD_BONUS } from '../../shared/constants';
import type { ApiUser } from '../../shared/types';
import { theme } from '../../shared/theme';

interface MatchSuccessModalProps {
  visible: boolean;
  user: ApiUser | null;
  currentUser: ApiUser | null;
  score: number;
  rewardLikes?: number;
  onClose: () => void;
  onOpenMessages?: () => void;
}

function MatchAvatar({ user, offset }: { user: ApiUser; offset: number }) {
  const photo = user.photos.find((item) => item.trim().length > 0) ?? null;

  return (
    <View style={[styles.avatarWrap, { marginLeft: offset }]}>
      {photo ? (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          recyclingKey={photo}
          source={{ uri: photo }}
          style={styles.avatar}
          transition={120}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <MaterialCommunityIcons name="account-outline" size={30} color={theme.colors.primarySoft} />
        </View>
      )}
    </View>
  );
}

export default function MatchSuccessModal({
  visible,
  user,
  currentUser,
  score,
  rewardLikes = MATCH_LIKE_REWARD_BONUS,
  onClose,
  onOpenMessages,
}: MatchSuccessModalProps) {
  const { t } = useLocalization();

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [onClose, visible]);

  if (!visible || !user || !currentUser) {
    return null;
  }

  return (
    <View style={styles.backdrop}>
      <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <LinearGradient
          colors={theme.gradients.matchSuccess}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          <View style={styles.badge}>
            <MaterialCommunityIcons name="heart-multiple" size={14} color={theme.colors.white} />
            <Text style={styles.badgeText}>{t('match.modal.badge')}</Text>
          </View>

          <View style={styles.avatars}>
            <MatchAvatar user={currentUser} offset={0} />
            <View style={styles.heartBubble}>
              <MaterialCommunityIcons name="heart" size={20} color={theme.colors.white} />
            </View>
            <MatchAvatar user={user} offset={-18} />
          </View>

          <View style={styles.copy}>
            <Text style={styles.title}>{t('match.modal.title')}</Text>
            <Text style={styles.subtitle}>{t('match.modal.subtitle', { name: user.name })}</Text>
          </View>

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>{t('match.modal.scoreLabel')}</Text>
            <Text style={styles.scoreValue}>%{score}</Text>
          </View>

          <View style={styles.rewardCard}>
            <MaterialCommunityIcons name="gift-outline" size={18} color={theme.colors.white} />
            <View style={styles.rewardCopy}>
              <Text style={styles.rewardTitle}>{t('match.modal.rewardTitle', { count: rewardLikes })}</Text>
              <Text style={styles.rewardDescription}>{t('match.modal.rewardDescription')}</Text>
            </View>
          </View>

          <View style={styles.buttonRow}>
            <Pressable onPress={onClose} style={[styles.button, styles.secondaryButton]}>
              <Text style={styles.secondaryButtonText}>{t('match.modal.continue')}</Text>
            </Pressable>
            {onOpenMessages ? (
              <Pressable
                onPress={() => {
                  onClose();
                  onOpenMessages();
                }}
                style={[styles.button, styles.primaryButton]}
              >
                <Text style={styles.primaryButtonText}>{t('match.modal.messages')}</Text>
              </Pressable>
            ) : null}
          </View>
        </LinearGradient>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: theme.alpha.matchScrim,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  safeArea: {
    justifyContent: 'center',
  },
  card: {
    borderRadius: 30,
    borderWidth: 1,
    borderColor: theme.alpha.white12,
    paddingHorizontal: 22,
    paddingVertical: 26,
    gap: 20,
    overflow: 'hidden',
  },
  badge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: theme.alpha.white14,
  },
  badgeText: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
  avatars: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: {
    width: 96,
    height: 96,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: theme.alpha.white22,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.alpha.white10,
  },
  heartBubble: {
    position: 'absolute',
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 2,
    borderColor: theme.alpha.white20,
  },
  copy: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: theme.colors.white,
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.alpha.white82,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  scoreCard: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: theme.alpha.white10,
    alignItems: 'center',
    gap: 6,
  },
  scoreLabel: {
    color: theme.alpha.white72,
    fontSize: 12,
    fontWeight: '700',
  },
  scoreValue: {
    color: theme.colors.white,
    fontSize: 28,
    fontWeight: '900',
  },
  rewardCard: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.alpha.white08,
    borderWidth: 1,
    borderColor: theme.alpha.white12,
  },
  rewardCopy: {
    flex: 1,
    gap: 4,
  },
  rewardTitle: {
    color: theme.colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  rewardDescription: {
    color: theme.alpha.white76,
    fontSize: 12,
    lineHeight: 18,
  },
  buttonRow: {
    gap: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButton: {
    backgroundColor: theme.colors.white,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: theme.alpha.white18,
    backgroundColor: theme.alpha.white08,
  },
  primaryButtonText: {
    color: theme.colors.black,
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButtonText: {
    color: theme.colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
});
