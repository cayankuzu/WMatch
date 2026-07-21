import { useEffect } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { MATCH_LIKE_REWARD_BONUS } from '../../shared/constants';
import type { ApiUser } from '../../shared/types';
import { theme } from '../../shared/theme';
import { triggerHaptic } from '../../services/haptics';
import AppImage from './ui/AppImage';
import AccessibleModal from './ui/AccessibleModal';

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
        <AppImage
          contentFit="cover"
          fallbackIcon="account-outline"
          recyclingKey={photo}
          uri={photo}
          style={styles.avatar}
          transition={theme.motion.fast}
        />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <MaterialCommunityIcons name="account-outline" size={24} color={theme.colors.primarySoft} />
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
    if (visible) {
      triggerHaptic('success');
    }
  }, [visible]);

  if (!visible || !user || !currentUser) {
    return null;
  }

  return (
    <AccessibleModal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
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
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.button, styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>{t('match.modal.continue')}</Text>
            </Pressable>
            {onOpenMessages ? (
              <Pressable
                onPress={() => {
                  onClose();
                  onOpenMessages();
                }}
                style={({ pressed }) => [styles.button, styles.primaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.primaryButtonText}>{t('match.modal.messages')}</Text>
              </Pressable>
            ) : null}
          </View>
        </LinearGradient>
        </SafeAreaView>
      </View>
    </AccessibleModal>
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
    paddingHorizontal: 16,
  },
  safeArea: {
    justifyContent: 'center',
  },
  card: {
    borderRadius: theme.radius.modal,
    borderWidth: 1,
    borderColor: theme.alpha.white12,
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
    overflow: 'hidden',
  },
  badge: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: theme.alpha.white14,
  },
  badgeText: {
    color: theme.colors.white,
    fontSize: 12,
    fontFamily: theme.fonts.bold,
  },
  avatars: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: {
    width: 80,
    height: 80,
    borderRadius: theme.radius.pill,
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
    borderRadius: theme.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySoft,
    borderWidth: 2,
    borderColor: theme.alpha.white20,
  },
  copy: {
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: theme.colors.white,
    ...theme.typography.roles.display,
  },
  subtitle: {
    color: theme.alpha.white82,
    ...theme.typography.roles.body,
    textAlign: 'center',
  },
  scoreCard: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.alpha.white10,
    alignItems: 'center',
    gap: 5,
  },
  scoreLabel: {
    color: theme.alpha.white72,
    fontSize: 12,
    fontFamily: theme.fonts.semibold,
  },
  scoreValue: {
    color: theme.colors.white,
    fontSize: 24,
    fontFamily: theme.fonts.extraBold,
  },
  rewardCard: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: theme.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
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
    fontSize: 12,
    fontFamily: theme.fonts.extraBold,
  },
  rewardDescription: {
    color: theme.alpha.white76,
    ...theme.typography.roles.body,
  },
  buttonRow: {
    gap: 8,
  },
  button: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
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
    fontSize: 12,
    fontFamily: theme.fonts.extraBold,
  },
  secondaryButtonText: {
    color: theme.colors.white,
    fontSize: 12,
    fontFamily: theme.fonts.bold,
  },
  buttonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
});
