import { PixelRatio, useWindowDimensions } from 'react-native';

import { theme } from '../../shared/theme';

export type WindowWidthClass = 'xCompact' | 'compact' | 'medium' | 'expanded';
export type WindowHeightClass = 'short' | 'regular' | 'tall';

export interface WindowClassLayout {
  width: number;
  height: number;
  fontScale: number;
  widthClass: WindowWidthClass;
  heightClass: WindowHeightClass;
  isLandscape: boolean;
  screenGutter: number;
  contentMaxWidth: number;
  readingMaxWidth: number;
  gridColumns: number;
}

export function getWindowClassLayout(
  width: number,
  height: number,
  fontScale = PixelRatio.getFontScale(),
): WindowClassLayout {
  const widthClass: WindowWidthClass =
    width < 360 ? 'xCompact' : width < 600 ? 'compact' : width < 840 ? 'medium' : 'expanded';
  const heightClass: WindowHeightClass = height < 600 ? 'short' : height < 900 ? 'regular' : 'tall';
  const screenGutter =
    widthClass === 'expanded'
      ? theme.layout.screenGutterExpanded
      : widthClass === 'medium'
        ? theme.layout.screenGutterMedium
        : theme.layout.screenGutterCompact;

  const gridColumns =
    widthClass === 'expanded'
      ? 4
      : widthClass === 'medium'
        ? 3
        : fontScale >= 1.5 || widthClass === 'xCompact'
          ? 1
          : 2;

  return {
    width,
    height,
    fontScale: fontScale || PixelRatio.getFontScale(),
    widthClass,
    heightClass,
    isLandscape: width > height,
    screenGutter,
    contentMaxWidth:
      widthClass === 'expanded'
        ? theme.layout.contentMaxWide
        : widthClass === 'medium'
          ? theme.layout.contentMaxReading
          : theme.layout.contentMaxNarrow,
    readingMaxWidth: theme.layout.contentMaxReading,
    gridColumns,
  };
}

export default function useWindowClass() {
  const { width, height, fontScale } = useWindowDimensions();

  return getWindowClassLayout(width, height, fontScale);
}
