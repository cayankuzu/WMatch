import type { ReactNode, RefObject } from 'react';
import { useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { theme } from '../../../shared/theme';
import { useLocalization } from '../../../context/LocalizationContext';
import { resolveDeviceEdgeInset } from '../../../shared/utils/safeArea';
import useWindowClass from '../../hooks/useWindowClass';
import useReducedMotion from '../../hooks/useReducedMotion';
import AppIconButton from './AppIconButton';
import AccessibleModal from './AccessibleModal';

interface AppModalProps {
  visible: boolean;
  title: string;
  children: ReactNode;
  presentation?: 'fullscreen' | 'dialog' | 'sheet';
  dismissible?: boolean;
  keyboardAware?: boolean;
  scrollable?: boolean;
  maxWidth?: number;
  initialFocusRef?: RefObject<View | null>;
  returnFocusRef?: RefObject<View | null>;
  footer?: ReactNode;
  onClose: () => void;
}

export default function AppModal({
  visible,
  title,
  children,
  presentation = 'dialog',
  dismissible = true,
  keyboardAware = false,
  scrollable = false,
  maxWidth,
  initialFocusRef,
  returnFocusRef,
  footer,
  onClose,
}: AppModalProps) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const layout = useWindowClass();
  const reduceMotion = useReducedMotion();
  const titleRef = useRef<Text>(null);
  const safeTopInset = resolveDeviceEdgeInset(insets.top);
  const safeBottomInset = resolveDeviceEdgeInset(insets.bottom);
  const resolvedMaxWidth =
    maxWidth ??
    (presentation === 'fullscreen'
      ? theme.layout.contentMaxWide
      : layout.widthClass === 'xCompact'
        ? layout.width - theme.layout.screenGutterCompact * 2
        : 560);
  const useFullscreenFallback = layout.heightClass === 'short' && presentation !== 'fullscreen';
  const resolvedPresentation = useFullscreenFallback ? 'fullscreen' : presentation;
  const shellStyle: ViewStyle =
    resolvedPresentation === 'sheet'
      ? styles.sheetShell
      : resolvedPresentation === 'dialog'
        ? styles.dialogShell
        : styles.fullscreenShell;

  const content = scrollable ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.body}>{children}</View>
  );

  const modalCard = (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[
        styles.card,
        resolvedPresentation === 'fullscreen' && styles.fullscreenCard,
        resolvedPresentation === 'sheet' && styles.sheetCard,
        { maxWidth: resolvedMaxWidth },
      ]}
    >
      <View style={styles.header}>
        <Text ref={titleRef} accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <AppIconButton
          accessibilityLabel={t('common.close')}
          disabled={!dismissible}
          icon={(
            <MaterialCommunityIcons
              accessible={false}
              color={theme.colors.textPrimary}
              name="close"
              size={theme.icon.lg}
            />
          )}
          onPress={onClose}
          variant="surface"
        />
      </View>
      {content}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );

  return (
    <AccessibleModal
      transparent
      visible={visible}
      animationType={reduceMotion ? 'none' : resolvedPresentation === 'fullscreen' ? 'slide' : 'fade'}
      initialFocusRef={initialFocusRef ?? titleRef}
      returnFocusRef={returnFocusRef}
      onRequestClose={dismissible ? onClose : undefined}
    >
      <KeyboardAvoidingView
        behavior={keyboardAware && Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.root,
          {
            paddingTop: safeTopInset,
            paddingRight: Math.max(insets.right, theme.layout.screenGutterCompact),
            paddingBottom: safeBottomInset,
            paddingLeft: Math.max(insets.left, theme.layout.screenGutterCompact),
          },
          shellStyle,
        ]}
      >
        {dismissible ? <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} /> : null}
        {modalCard}
      </KeyboardAvoidingView>
    </AccessibleModal>
  );
}

export function AppSheet(props: Omit<AppModalProps, 'presentation'>) {
  return <AppModal {...props} presentation="sheet" />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
  },
  dialogShell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetShell: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  fullscreenShell: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  card: {
    width: '100%',
    maxHeight: '100%',
    borderRadius: theme.radius.modal,
    borderWidth: 1,
    borderColor: theme.colors.borderDefault,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    shadowColor: theme.colors.black,
    ...theme.elevation.modalShadow,
  },
  fullscreenCard: {
    flex: 1,
    borderRadius: 0,
  },
  sheetCard: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  header: {
    minHeight: theme.layout.controlMinUnified + theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
  },
  title: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.typography.roles.sectionTitle.fontSize,
    lineHeight: theme.typography.roles.sectionTitle.lineHeight,
    fontFamily: theme.fonts.bold,
  },
  body: {
    padding: theme.spacing.lg,
  },
  scrollContent: {
    padding: theme.spacing.lg,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderSubtle,
    padding: theme.spacing.lg,
  },
});
