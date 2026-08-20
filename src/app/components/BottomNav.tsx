import { memo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLocalization } from '../../context/LocalizationContext';
import { SCREEN_SIDE_SPACING } from '../../shared/constants';
import type { AppTab } from '../../shared/types';
import { theme } from '../../shared/theme';
import { resolveDeviceEdgeInset } from '../../shared/utils/safeArea';
import useWindowClass from '../hooks/useWindowClass';
import BottomNavItem from './BottomNavItem';

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
  activeIcon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  { id: 'watch', labelKey: 'nav.watch', icon: 'television-play', activeIcon: 'television-play' },
  { id: 'match', labelKey: 'nav.match', icon: 'cards-heart-outline', activeIcon: 'cards-heart' },
  { id: 'compatibility', labelKey: 'nav.compatibility', icon: 'chart-line-variant', activeIcon: 'chart-line' },
  { id: 'likes', labelKey: 'nav.likes', icon: 'heart-outline', activeIcon: 'heart' },
  { id: 'chat', labelKey: 'nav.chat', icon: 'message-text-outline', activeIcon: 'message-text' },
  { id: 'profile', labelKey: 'nav.profile', icon: 'account-outline', activeIcon: 'account' },
];

interface BottomNavProps {
  activeTab: AppTab;
  onTabChange: (tabId: AppTab) => void;
  onTabIntent?: (tabId: AppTab) => void;
  onTabReselect?: (tabId: AppTab) => void;
  onHeightChange?: (height: number) => void;
  badges?: Partial<Record<AppTab, number>>;
}

function BottomNav({
  activeTab,
  onTabChange,
  onTabIntent,
  onTabReselect,
  onHeightChange,
  badges,
}: BottomNavProps) {
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

          return (
            <BottomNavItem
              key={item.id}
              active={isActive}
              activeIcon={item.activeIcon}
              badge={badges?.[item.id]}
              compact={compactLabels}
              icon={item.icon}
              label={t(item.labelKey)}
              testID={`bottom-nav-${item.id}`}
              onIntent={() => onTabIntent?.(item.id)}
              onPress={() => {
                if (isActive) {
                  onTabReselect?.(item.id);
                } else {
                  onTabChange(item.id);
                }
              }}
            />
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
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
    paddingHorizontal: 3,
    paddingVertical: 3,
    gap: 0,
  },
});
