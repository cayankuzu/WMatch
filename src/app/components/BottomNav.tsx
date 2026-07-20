import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import type { AppTab } from '../../shared/types';
import { theme } from '../../shared/theme';
import { resolveDeviceEdgeInset } from '../../shared/utils/safeArea';
import useWindowClass from '../hooks/useWindowClass';

const navItems: Array<{
  id: AppTab;
  labelKey:
    | 'nav.watch'
    | 'nav.match'
    | 'nav.compatibility'
    | 'nav.likes'
    | 'nav.chat'
    | 'nav.profile';
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  { id: 'watch', labelKey: 'nav.watch', icon: 'television-play' },
  { id: 'match', labelKey: 'nav.match', icon: 'cards-heart' },
  { id: 'compatibility', labelKey: 'nav.compatibility', icon: 'chart-line' },
  { id: 'likes', labelKey: 'nav.likes', icon: 'heart-outline' },
  { id: 'chat', labelKey: 'nav.chat', icon: 'message-text-outline' },
  { id: 'profile', labelKey: 'nav.profile', icon: 'account-outline' },
];

interface BottomNavProps {
  activeTab: AppTab;
  onTabChange: (tabId: AppTab) => void;
  onTabIntent?: (tabId: AppTab) => void;
  onHeightChange?: (height: number) => void;
}

function BottomNav({ activeTab, onTabChange, onTabIntent, onHeightChange }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const { t } = useLocalization();
  const layout = useWindowClass();
  const safeBottomInset = resolveDeviceEdgeInset(insets.bottom);
  const compactLabels = layout.widthClass === 'xCompact' || layout.fontScale >= 1.3;
  const navMaxWidth = layout.widthClass === 'expanded' ? 760 : layout.widthClass === 'medium' ? 680 : undefined;

  const handleLayout = (event: LayoutChangeEvent) => {
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        {
          bottom: 0,
          paddingBottom: safeBottomInset,
          paddingHorizontal: Math.max(SCREEN_SIDE_SPACING, layout.screenGutter),
        },
      ]}
    >
      <View
        accessibilityRole="tablist"
        onLayout={handleLayout}
        style={[styles.container, navMaxWidth ? { maxWidth: navMaxWidth } : null]}
      >
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const showLabel = !compactLabels || isActive;

          return (
            <Pressable
              key={item.id}
              onPressIn={() => onTabIntent?.(item.id)}
              onPress={() => onTabChange(item.id)}
              accessibilityRole="tab"
              accessibilityLabel={t(item.labelKey)}
              accessibilityState={{ selected: isActive }}
              android_ripple={{ color: theme.colors.primarySurface, borderless: false }}
              hitSlop={4}
              style={({ pressed }) => [styles.item, isActive && styles.activeItem, pressed && styles.pressedItem]}
            >
              <MaterialCommunityIcons
                name={item.icon}
                size={compactLabels ? 22 : 20}
                color={isActive ? theme.colors.primarySoft : theme.colors.textSoft}
              />
              {showLabel ? (
                <Text
                  numberOfLines={compactLabels ? 1 : 2}
                  style={[styles.label, compactLabels && styles.labelCompact, isActive && styles.activeLabel]}
                >
                  {t(item.labelKey)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default memo(BottomNav);

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  container: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: theme.colors.glass,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 3,
  },
  item: {
    flex: 1,
    minHeight: theme.layout.controlMinUnified,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 7,
    borderRadius: 16,
  },
  activeItem: {
    backgroundColor: theme.colors.primarySurface,
  },
  pressedItem: {
    backgroundColor: theme.colors.surfaceStrong,
  },
  label: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.roles.meta.fontSize,
    lineHeight: theme.typography.roles.meta.lineHeight,
    fontWeight: '700',
    textAlign: 'center',
  },
  labelCompact: {
    fontSize: theme.typography.roles.micro.fontSize,
    lineHeight: theme.typography.roles.micro.lineHeight,
  },
  activeLabel: {
    color: theme.colors.primarySoft,
  },
});
