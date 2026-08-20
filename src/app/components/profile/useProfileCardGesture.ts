import { useCallback, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const HORIZONTAL_SWIPE_THRESHOLD = 110;
const DOWN_SWIPE_THRESHOLD = 88;
const INTENT_THRESHOLD = 12;

interface ProfileCardGestureOptions {
  enabled: boolean;
  allowLeft: boolean;
  allowRight: boolean;
  allowDown: boolean;
  onLeft?: () => void;
  onRight?: () => void;
  onDown?: () => void;
}

export function useProfileCardGesture({
  enabled,
  allowLeft,
  allowRight,
  allowDown,
  onLeft,
  onRight,
  onDown,
}: ProfileCardGestureOptions) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const scrollOffset = useSharedValue(0);

  const commitLeft = useCallback(() => onLeft?.(), [onLeft]);
  const commitRight = useCallback(() => onRight?.(), [onRight]);
  const commitDown = useCallback(() => onDown?.(), [onDown]);

  const reset = useCallback(() => {
    translateX.value = 0;
    translateY.value = 0;
    scrollOffset.value = 0;
  }, [scrollOffset, translateX, translateY]);

  const gesture = useMemo(
    () => Gesture.Pan()
      .enabled(enabled)
      .manualActivation(true)
      .onTouchesDown((event) => {
        const touch = event.allTouches[0];
        if (touch) {
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
        }
      })
      .onTouchesMove((event, stateManager) => {
        const touch = event.allTouches[0];
        if (!touch) {
          return;
        }

        const deltaX = touch.absoluteX - startX.value;
        const deltaY = touch.absoluteY - startY.value;
        const horizontal = Math.abs(deltaX) > INTENT_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY);
        const downward = deltaY > INTENT_THRESHOLD && deltaY > Math.abs(deltaX);

        if (horizontal) {
          (deltaX > 0 ? allowRight : allowLeft) ? stateManager.activate() : stateManager.fail();
          return;
        }

        if (downward) {
          allowDown && scrollOffset.value <= 0 ? stateManager.activate() : stateManager.fail();
          return;
        }

        if (Math.abs(deltaY) > INTENT_THRESHOLD) {
          stateManager.fail();
        }
      })
      .onUpdate((event) => {
        const isDownwardSwipe = event.translationY > 0 && event.translationY > Math.abs(event.translationX);
        if (isDownwardSwipe && allowDown && scrollOffset.value <= 0) {
          translateX.value = 0;
          translateY.value = event.translationY;
          return;
        }

        translateY.value = 0;
        translateX.value = event.translationX;
      })
      .onEnd((event) => {
        if (translateY.value > DOWN_SWIPE_THRESHOLD && allowDown) {
          translateY.value = withTiming(180, { duration: 120 }, (finished) => {
            if (finished) {
              translateY.value = 0;
              runOnJS(commitDown)();
            }
          });
          return;
        }

        if (translateX.value > HORIZONTAL_SWIPE_THRESHOLD && allowRight) {
          translateX.value = withTiming(420, { duration: 110 }, (finished) => {
            if (finished) {
              translateX.value = 0;
              runOnJS(commitRight)();
            }
          });
          return;
        }

        if (translateX.value < -HORIZONTAL_SWIPE_THRESHOLD && allowLeft) {
          translateX.value = withTiming(-420, { duration: 110 }, (finished) => {
            if (finished) {
              translateX.value = 0;
              runOnJS(commitLeft)();
            }
          });
          return;
        }

        translateX.value = withSpring(0, { damping: 18, stiffness: 220, velocity: event.velocityX });
        translateY.value = withSpring(0, { damping: 18, stiffness: 220, velocity: event.velocityY });
      })
      .onFinalize((_event, success) => {
        if (!success) {
          translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
          translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
        }
      }),
    [
      allowDown,
      allowLeft,
      allowRight,
      commitDown,
      commitLeft,
      commitRight,
      enabled,
      scrollOffset,
      startX,
      startY,
      translateX,
      translateY,
    ],
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: enabled ? translateX.value : 0 },
      { translateY: enabled ? translateY.value : 0 },
      { rotate: enabled ? `${Math.max(-8, Math.min(8, translateX.value / 27.5))}deg` : '0deg' },
    ],
  }));
  const leftCueStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, -translateX.value / 90)),
  }));
  const rightCueStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, translateX.value / 90)),
  }));
  const downCueStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, translateY.value / 80)),
  }));
  const handleScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.value = event.contentOffset.y;
  });

  return { cardStyle, downCueStyle, gesture, handleScroll, leftCueStyle, reset, rightCueStyle };
}
