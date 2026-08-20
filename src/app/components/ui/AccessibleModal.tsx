import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  StyleSheet,
  Text,
  View,
  type ModalProps,
} from 'react-native';

interface AccessibleModalProps extends Omit<ModalProps, 'children' | 'onShow' | 'onDismiss'> {
  children: ReactNode;
  initialFocusRef?: RefObject<View | Text | null>;
  returnFocusRef?: RefObject<View | null>;
}

export default function AccessibleModal({
  children,
  visible = true,
  initialFocusRef,
  returnFocusRef,
  ...modalProps
}: AccessibleModalProps) {
  const modalRootRef = useRef<View>(null);
  const wasVisibleRef = useRef(false);

  const focusModal = () => {
    const frame = requestAnimationFrame(() => {
      const focusTarget = initialFocusRef?.current ?? modalRootRef.current;
      const node = focusTarget ? findNodeHandle(focusTarget) : null;
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    });

    return () => cancelAnimationFrame(frame);
  };

  const restoreFocus = () => {
    const node = returnFocusRef?.current ? findNodeHandle(returnFocusRef.current) : null;
    if (node) {
      AccessibilityInfo.setAccessibilityFocus(node);
    }
  };

  useEffect(() => {
    if (visible) {
      wasVisibleRef.current = true;
      return;
    }

    if (wasVisibleRef.current) {
      wasVisibleRef.current = false;
      restoreFocus();
    }

    return;
  }, [returnFocusRef, visible]);

  return (
    <Modal
      {...modalProps}
      visible={visible}
      onShow={() => {
        focusModal();
      }}
    >
      <View
        ref={modalRootRef}
        accessibilityViewIsModal
        importantForAccessibility="yes"
        collapsable={false}
        style={styles.root}
      >
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
