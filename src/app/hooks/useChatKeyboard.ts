import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type TextInput,
} from 'react-native';

import { calculateKeyboardInset } from '../../shared/utils/keyboard';

const ANDROID_COMPOSER_GAP = 32;
const KEYBOARD_RESET_DELAY_MS = 350;

export default function useChatKeyboard(canSend: boolean) {
  const [visible, setVisible] = useState(false);
  const [androidInset, setAndroidInset] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const focusedRef = useRef(false);
  const rootHeightRef = useRef(0);
  const rootHeightWithoutKeyboardRef = useRef(0);
  const androidKeyboardHeightRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelReset = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  const resetKeyboardState = useCallback(() => {
    setVisible(false);
    setAndroidInset(0);
    androidKeyboardHeightRef.current = 0;
  }, []);

  useEffect(() => cancelReset, [cancelReset]);

  useEffect(() => {
    if (!canSend) {
      focusedRef.current = false;
      cancelReset();
      resetKeyboardState();
      return;
    }

    const syncAndroidInset = (keyboardHeight: number) => {
      if (Platform.OS !== 'android') {
        return;
      }

      const nextInset = calculateKeyboardInset(
        rootHeightWithoutKeyboardRef.current,
        rootHeightRef.current,
        keyboardHeight,
        ANDROID_COMPOSER_GAP,
      );
      setAndroidInset((current) => current === nextInset ? current : nextInset);
    };

    const handleShown = (event: KeyboardEvent) => {
      cancelReset();
      setVisible(true);

      if (Platform.OS === 'android') {
        const measuredHeight = Keyboard.metrics()?.height ?? 0;
        const keyboardHeight = Math.max(event.endCoordinates.height, measuredHeight, 0);
        androidKeyboardHeightRef.current = keyboardHeight;
        syncAndroidInset(keyboardHeight);
      }
    };

    const handleHidden = () => {
      cancelReset();
      resetKeyboardState();
    };

    const showSubscription = Keyboard.addListener('keyboardDidShow', handleShown);
    const hideSubscription = Keyboard.addListener('keyboardDidHide', handleHidden);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [canSend, cancelReset, resetKeyboardState]);

  const handleRootLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    rootHeightRef.current = height;

    if (Platform.OS !== 'android') {
      return;
    }

    const keyboardHeight = androidKeyboardHeightRef.current;
    if (keyboardHeight <= 0) {
      rootHeightWithoutKeyboardRef.current = height;
      return;
    }

    const nextInset = calculateKeyboardInset(
      rootHeightWithoutKeyboardRef.current,
      height,
      keyboardHeight,
      ANDROID_COMPOSER_GAP,
    );
    setAndroidInset((current) => current === nextInset ? current : nextInset);
  }, []);

  const dismiss = useCallback(() => {
    if (!focusedRef.current && !visible) {
      return;
    }

    inputRef.current?.blur();
    Keyboard.dismiss();
    focusedRef.current = false;
    cancelReset();
    resetTimerRef.current = setTimeout(() => {
      resetKeyboardState();
      resetTimerRef.current = null;
    }, KEYBOARD_RESET_DELAY_MS);
  }, [cancelReset, resetKeyboardState, visible]);

  const handleFocusChange = useCallback((focused: boolean) => {
    focusedRef.current = focused;
  }, []);

  return {
    androidInset,
    dismiss,
    handleFocusChange,
    handleRootLayout,
    inputRef,
    visible,
  };
}
