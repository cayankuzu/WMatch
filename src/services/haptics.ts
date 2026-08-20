import * as Haptics from 'expo-haptics';

export type HapticFeedback = 'none' | 'selection' | 'success' | 'warning' | 'error';

let lastFeedbackAt = 0;
const MIN_FEEDBACK_INTERVAL_MS = 45;

/** Keeps tactile feedback intentional, non-blocking, and resistant to rapid double firing. */
export function triggerHaptic(feedback: HapticFeedback = 'selection') {
  if (feedback === 'none') {
    return;
  }

  const now = Date.now();
  if (now - lastFeedbackAt < MIN_FEEDBACK_INTERVAL_MS) {
    return;
  }
  lastFeedbackAt = now;

  const task = feedback === 'selection'
    ? Haptics.selectionAsync()
    : Haptics.notificationAsync(
        feedback === 'success'
          ? Haptics.NotificationFeedbackType.Success
          : feedback === 'warning'
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Error,
      );

  void task.catch(() => undefined);
}
