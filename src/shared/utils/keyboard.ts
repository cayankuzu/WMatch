export function calculateKeyboardInset(
  heightWithoutKeyboard: number,
  currentHeight: number,
  keyboardHeight: number,
  visibleGap = 0,
): number {
  const resizedBy = Math.max(0, heightWithoutKeyboard - currentHeight);
  const keyboardInset = Math.max(0, Math.round(keyboardHeight - resizedBy));
  const safeVisibleGap = keyboardHeight > 0 ? Math.max(0, Math.round(visibleGap)) : 0;

  return keyboardInset + safeVisibleGap;
}
