export function getFixedGridItemWidth(containerWidth: number, columns: number, gap: number) {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeGap = Math.max(0, gap);
  const safeContainerWidth = Math.max(1, containerWidth);
  const totalGap = (safeColumns - 1) * safeGap;

  return Math.max(1, Math.floor((safeContainerWidth - totalGap) / safeColumns));
}
