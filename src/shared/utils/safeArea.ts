export const MIN_DEVICE_EDGE_INSET = 12;

export function resolveDeviceEdgeInset(inset: number, minimum = MIN_DEVICE_EDGE_INSET) {
  return Number.isFinite(inset) ? Math.max(inset, minimum) : minimum;
}

export interface BottomObstructionInput {
  safeBottom: number;
  bottomNavHeight?: number;
  keyboardHeight?: number;
  extraGap?: number;
}

export function resolveBottomObstruction({
  safeBottom,
  bottomNavHeight = 0,
  keyboardHeight = 0,
  extraGap = 16,
}: BottomObstructionInput) {
  const resolvedSafeBottom = resolveDeviceEdgeInset(safeBottom);
  const navObstruction = bottomNavHeight > 0 ? bottomNavHeight + resolvedSafeBottom : resolvedSafeBottom;
  const keyboardObstruction = keyboardHeight > 0 ? keyboardHeight : 0;

  return Math.max(resolvedSafeBottom, navObstruction, keyboardObstruction) + extraGap;
}
