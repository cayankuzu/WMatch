import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  StyleSheet,
  View,
  type ModalProps,
} from 'react-native';

interface AccessibleModalProps extends Omit<ModalProps, 'children' | 'onShow' | 'onDismiss'> {
  children: ReactNode;
  returnFocusRef?: RefObject<View | null>;
}

export default function AccessibleModal({
  children,
  visible = true,
  returnFocusRef,
  ...modalProps
}: AccessibleModalProps) {
  const modalRootRef = useRef<View>(null);
  const wasVisibleRef = useRef(false);

  const focusModal = () => {
    const frame = requestAnimationFrame(() => {
      const node = modalRootRef.current ? findNodeHandle(modalRootRef.current) : null;
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
      return focusModal();
    }

    if (wasVisibleRef.current) {
      wasVisibleRef.current = false;
      restoreFocus();
    }

    return undefined;
  }, [returnFocusRef, visible]);

  return (
    <Modal
      {...modalProps}
      visible={visible}
      onShow={() => {
        focusModal();
      }}
      onDismiss={() => {
        restoreFocus();
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
