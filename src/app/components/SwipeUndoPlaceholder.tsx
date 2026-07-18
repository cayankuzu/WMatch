import { useMemo, useRef } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { useLocalization } from '../../context/LocalizationContext';
import { PROFILE_CARD_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../shared/constants';
import { theme } from '../../shared/theme';

interface SwipeUndoPlaceholderProps {
  onUndo?: () => void;
  onReload?: () => void;
  onBack?: () => void;
  bottomInset?: number;
  undoPending?: boolean;
}

const SWIPE_DOWN_THRESHOLD = 90;

export default function SwipeUndoPlaceholder({
  onUndo,
  onReload,
  onBack,
  bottomInset = 0,
  undoPending = false,
}: SwipeUndoPlaceholderProps) {
  const { t } = useLocalization();
  const undoEnabled = Boolean(onUndo);
  const panY = useRef(new Animated.Value(0)).current;
  const cardScale = panY.interpolate({
    inputRange: [0, SWIPE_DOWN_THRESHOLD],
    outputRange: [1, 0.988],
    extrapolate: 'clamp',
  });
  const undoCueOpacity = panY.interpolate({
    inputRange: [0, 22, SWIPE_DOWN_THRESHOLD],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });
  const undoCueScale = panY.interpolate({
    inputRange: [0, 22, SWIPE_DOWN_THRESHOLD],
    outputRange: [0.88, 0.96, 1],
    extrapolate: 'clamp',
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => undoEnabled,
        onStartShouldSetPanResponderCapture: () => undoEnabled,
        onMoveShouldSetPanResponder: (_, gesture) =>
          undoEnabled && gesture.dy > 6 && gesture.dy > Math.abs(gesture.dx) * 0.7,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          undoEnabled && gesture.dy > 4 && gesture.dy > Math.abs(gesture.dx) * 0.6,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          panY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy >= SWIPE_DOWN_THRESHOLD && onUndo) {
            Animated.timing(panY, {
              toValue: 0,
              duration: 140,
              useNativeDriver: true,
            }).start(() => {
              onUndo();
            });
            return;
          }

          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(panY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [onUndo, panY, undoEnabled],
  );

  return (
    <View style={[styles.content, { paddingBottom: PROFILE_CARD_BOTTOM_SPACING + bottomInset }]}>
      {onBack || onReload ? (
        <View style={styles.swipeTopBar}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={onBack} style={styles.swipeTopBarButton}>
              <MaterialCommunityIcons name="arrow-left" size={20} color={theme.colors.primarySoft} />
            </Pressable>
          ) : (
            <View style={styles.swipeTopBarSpacer} />
          )}

          {onReload ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('a11y.reload')} onPress={onReload} style={styles.swipeTopBarButton}>
              <MaterialCommunityIcons name="reload" size={18} color={theme.colors.primarySoft} />
            </Pressable>
          ) : (
            <View style={styles.swipeTopBarSpacer} />
          )}
        </View>
      ) : null}

      <Animated.View
        style={[styles.card, { transform: [{ translateY: panY }, { scale: cardScale }] }]}
        {...(onUndo ? panResponder.panHandlers : {})}
      >
        <View style={styles.hero}>
          <View style={styles.photoProgress}>
            <View style={[styles.photoProgressItem, styles.photoProgressItemActive]} />
            <View style={styles.photoProgressItem} />
            <View style={styles.photoProgressItem} />
          </View>

          <View style={styles.emptyBadge}>
            <MaterialCommunityIcons name="cards-outline" size={16} color={theme.colors.white} />
            <Text style={styles.emptyBadgeText}>{t('swipe.placeholder.badge')}</Text>
          </View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.undoCue,
              {
                opacity: undoCueOpacity,
                transform: [{ scale: undoCueScale }],
              },
            ]}
          >
            <MaterialCommunityIcons name="undo-variant" size={34} color={theme.colors.white} />
            <Text style={styles.undoCueText}>{t('common.back')}</Text>
          </Animated.View>

          <View style={styles.downArrow}>
            <MaterialCommunityIcons name="arrow-down-thin-circle-outline" size={44} color={theme.colors.white} />
          </View>

          <View accessible={false} pointerEvents="none" style={[styles.sideButton, styles.sideButtonLeft]}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={theme.alpha.white42} />
          </View>
          <View accessible={false} pointerEvents="none" style={[styles.sideButton, styles.sideButtonRight]}>
            <MaterialCommunityIcons name="chevron-right" size={22} color={theme.alpha.white42} />
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{t('swipe.placeholder.title')}</Text>
          <Text style={styles.description}>
            {undoPending
              ? t('swipe.placeholder.description.pending')
              : undoEnabled
              ? t('swipe.placeholder.description.undoAvailable')
              : t('swipe.placeholder.description.reloadOnly')}
          </Text>
          <View style={styles.metaRow}>
            {undoPending ? (
              <View style={styles.metaPill}>
                <MaterialCommunityIcons name="progress-clock" size={15} color={theme.colors.warning} />
                <Text style={styles.metaText}>{t('swipe.placeholder.status.pending')}</Text>
              </View>
            ) : undoEnabled ? (
              <View style={styles.metaPill}>
                <MaterialCommunityIcons name="gesture-swipe-down" size={15} color={theme.colors.primarySoft} />
                <Text style={styles.metaText}>{t('swipe.placeholder.status.available')}</Text>
              </View>
            ) : (
              <View style={styles.metaPill}>
                <MaterialCommunityIcons name="lock-outline" size={15} color={theme.colors.textSoft} />
                <Text style={styles.metaText}>{t('swipe.placeholder.status.unavailable')}</Text>
              </View>
            )}
            <View style={styles.metaPill}>
              <MaterialCommunityIcons name="minus-circle-outline" size={15} color={theme.colors.textSoft} />
              <Text style={styles.metaText}>{t('swipe.placeholder.status.inactive')}</Text>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 12,
  },
  swipeTopBar: {
    marginBottom: 10,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.glass,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  swipeTopBarSpacer: {
    width: theme.layout.controlMinUnified,
    height: theme.layout.controlMinUnified,
  },
  swipeTopBarButton: {
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  card: {
    flex: 1,
    minHeight: 0,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    overflow: 'hidden',
  },
  hero: {
    flex: 1,
    minHeight: 260,
    maxHeight: 350,
    backgroundColor: theme.colors.surface,
    justifyContent: 'space-between',
    padding: 16,
  },
  photoProgress: {
    flexDirection: 'row',
    gap: 6,
  },
  photoProgressItem: {
    flex: 1,
    height: 4,
    borderRadius: 999,
    backgroundColor: theme.alpha.white22,
  },
  photoProgressItemActive: {
    backgroundColor: theme.colors.white,
  },
  emptyBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.scrim,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  emptyBadgeText: {
    color: theme.colors.white,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
  undoCue: {
    position: 'absolute',
    top: 110,
    alignSelf: 'center',
    width: 92,
    height: 92,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 2,
    borderColor: theme.colors.white,
    backgroundColor: theme.alpha.info84,
  },
  undoCueText: {
    color: theme.colors.white,
    fontSize: 12,
    fontWeight: '900',
  },
  downArrow: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideButton: {
    position: 'absolute',
    top: '46%',
    minWidth: theme.layout.controlMinUnified,
    minHeight: theme.layout.controlMinUnified,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.scrim,
    borderWidth: 1,
    borderColor: theme.alpha.white08,
  },
  sideButtonLeft: {
    left: 14,
  },
  sideButtonRight: {
    right: 14,
  },
  body: {
    flexShrink: 1,
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 20,
  },
  title: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  description: {
    color: theme.colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metaPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metaText: {
    color: theme.colors.text,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '800',
  },
});
