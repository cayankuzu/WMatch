import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../../../shared/theme';
import { resolveDeviceEdgeInset } from '../../../shared/utils/safeArea';
import useWindowClass from '../../hooks/useWindowClass';

interface ScreenProps {
  children: ReactNode;
  mode?: 'scroll' | 'fixed' | 'list';
  scroll?: boolean;
  contentMaxWidth?: number | 'none';
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export default function Screen({
  children,
  mode,
  scroll = false,
  contentMaxWidth,
  contentContainerStyle,
  style,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const layout = useWindowClass();
  const safeTopInset = resolveDeviceEdgeInset(insets.top);
  const safeBottomInset = resolveDeviceEdgeInset(insets.bottom);
  const resolvedMode = mode ?? (scroll ? 'scroll' : 'fixed');
  const resolvedMaxWidth =
    contentMaxWidth === 'none'
      ? undefined
      : contentMaxWidth ?? layout.contentMaxWidth;
  const contentFrameStyle = resolvedMaxWidth
    ? {
        width: '100%' as const,
        maxWidth: resolvedMaxWidth,
        alignSelf: 'center' as const,
      }
    : null;
  const content = resolvedMode === 'scroll' ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      contentContainerStyle={[
        styles.scrollContent,
        layout.heightClass === 'short' && styles.scrollContentShort,
        contentFrameStyle,
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, contentFrameStyle, contentContainerStyle]}>{children}</View>
  );

  return (
    <LinearGradient
      colors={theme.gradients.appBackground}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.gradient, style]}
    >
      <View
        style={[
          styles.safeArea,
          {
            paddingTop: safeTopInset,
            paddingBottom: safeBottomInset,
          },
        ]}
      >
        <KeyboardAvoidingView
          style={styles.keyboard}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {content}
        </KeyboardAvoidingView>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing.xl,
  },
  scrollContentShort: {
    paddingBottom: theme.spacing.xxl,
  },
});
