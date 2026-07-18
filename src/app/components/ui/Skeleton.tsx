import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { SCREEN_BOTTOM_SPACING, SCREEN_SIDE_SPACING } from '../../../shared/constants';
import { theme } from '../../../shared/theme';
import useWindowClass from '../../hooks/useWindowClass';

interface SkeletonBlockProps {
  style?: StyleProp<ViewStyle>;
}

export function SkeletonBlock({ style }: SkeletonBlockProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      pointerEvents="none"
      style={[styles.block, style]}
    />
  );
}

export function ChatListSkeleton() {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <SkeletonBlock style={styles.title} />
        <SkeletonBlock style={styles.subtitle} />
      </View>

      <View style={styles.matchRow}>
        {Array.from({ length: 5 }).map((_, index) => (
          <View key={index} style={styles.matchItem}>
            <SkeletonBlock style={styles.matchAvatar} />
            <SkeletonBlock style={styles.matchName} />
          </View>
        ))}
      </View>

      {Array.from({ length: 7 }).map((_, index) => (
        <View key={index} style={styles.chatRow}>
          <SkeletonBlock style={styles.avatar} />
          <View style={styles.chatText}>
            <SkeletonBlock style={styles.chatTitle} />
            <SkeletonBlock style={styles.chatPreview} />
          </View>
          <SkeletonBlock style={styles.chatMeta} />
        </View>
      ))}
    </View>
  );
}

export function UserGridSkeleton({ count = 6 }: { count?: number }) {
  const { gridColumns } = useWindowClass();
  const cardWidth = `${Math.max(100 / gridColumns - (gridColumns > 1 ? 3 : 0), 0)}%` as const;

  return (
    <View style={styles.gridScreen}>
      <View style={styles.header}>
        <SkeletonBlock style={styles.title} />
        <SkeletonBlock style={styles.subtitle} />
      </View>

      <View style={styles.grid}>
        {Array.from({ length: count }).map((_, index) => (
          <View key={index} style={[styles.userCard, { width: cardWidth }]}>
            <SkeletonBlock style={styles.userPhoto} />
            <View style={styles.userBody}>
              <SkeletonBlock style={styles.userName} />
              <SkeletonBlock style={styles.userMeta} />
              <SkeletonBlock style={styles.userBio} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function SwipeDeckSkeleton() {
  return (
    <View style={styles.deckScreen}>
      <View style={styles.deckCard}>
        <SkeletonBlock style={styles.deckPhoto} />
        <View style={styles.deckBody}>
          <SkeletonBlock style={styles.deckName} />
          <SkeletonBlock style={styles.deckLine} />
          <SkeletonBlock style={styles.deckLineShort} />
        </View>
      </View>
    </View>
  );
}

export function MessageThreadSkeleton() {
  return (
    <View style={styles.thread}>
      {Array.from({ length: 7 }).map((_, index) => {
        const own = index % 3 === 2;
        return (
          <View key={index} style={[styles.bubbleRow, own && styles.bubbleRowOwn]}>
            <SkeletonBlock style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: theme.colors.skeletonSurface,
    borderWidth: 1,
    borderColor: theme.colors.skeletonBorder,
  },
  screen: {
    flex: 1,
    gap: 16,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 18,
    paddingBottom: SCREEN_BOTTOM_SPACING,
    backgroundColor: theme.colors.background,
  },
  gridScreen: {
    flex: 1,
    paddingHorizontal: SCREEN_SIDE_SPACING,
    paddingTop: 18,
    paddingBottom: SCREEN_BOTTOM_SPACING + 82,
    backgroundColor: theme.colors.background,
  },
  header: {
    gap: 8,
  },
  title: {
    width: 152,
    height: 24,
  },
  subtitle: {
    width: '72%',
    height: 13,
  },
  matchRow: {
    flexDirection: 'row',
    gap: 12,
  },
  matchItem: {
    alignItems: 'center',
    gap: 8,
    width: 62,
  },
  matchAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  matchName: {
    width: 46,
    height: 10,
  },
  chatRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  chatText: {
    flex: 1,
    gap: 9,
  },
  chatTitle: {
    width: '48%',
    height: 14,
  },
  chatPreview: {
    width: '82%',
    height: 12,
  },
  chatMeta: {
    width: 38,
    height: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 14,
    paddingTop: 20,
  },
  userCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  userPhoto: {
    width: '100%',
    aspectRatio: 0.78,
    borderRadius: 0,
  },
  userBody: {
    gap: 8,
    padding: 12,
  },
  userName: {
    width: '72%',
    height: 14,
  },
  userMeta: {
    width: '46%',
    height: 12,
  },
  userBio: {
    width: '92%',
    height: 28,
  },
  deckScreen: {
    flex: 1,
    padding: SCREEN_SIDE_SPACING,
    paddingBottom: SCREEN_BOTTOM_SPACING + 82,
    backgroundColor: theme.colors.background,
  },
  deckCard: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
  },
  deckPhoto: {
    flex: 1,
    minHeight: 260,
    borderRadius: 0,
  },
  deckBody: {
    gap: 10,
    padding: 18,
  },
  deckName: {
    width: '58%',
    height: 24,
  },
  deckLine: {
    width: '86%',
    height: 13,
  },
  deckLineShort: {
    width: '62%',
    height: 13,
  },
  thread: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowOwn: {
    justifyContent: 'flex-end',
  },
  bubble: {
    height: 38,
    borderRadius: 18,
  },
  bubbleOther: {
    width: '58%',
  },
  bubbleOwn: {
    width: '46%',
    backgroundColor: theme.colors.primarySurface,
  },
});
