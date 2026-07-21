import { useEffect, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Image,
  type ImageContentFit,
  type ImageProps,
  type ImageStyle,
} from 'expo-image';
import { StyleSheet, View, type StyleProp } from 'react-native';

import { theme } from '../../../shared/theme';

const NEUTRAL_BLURHASH = 'L02rs+WB00WB~qof4nof00of~qof';

interface AppImageProps {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  contentFit?: ImageContentFit;
  priority?: ImageProps['priority'];
  recyclingKey?: string;
  transition?: number;
  fallbackIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  blurRadius?: number;
  enforceEarlyResizing?: boolean;
  onDisplay?: ImageProps['onDisplay'];
}

/** Shared image surface with stable layout, disk cache, placeholder, and branded failure state. */
export default function AppImage({
  uri,
  style,
  accessibilityLabel,
  contentFit = 'cover',
  priority = 'normal',
  recyclingKey,
  transition = theme.motion.fast,
  fallbackIcon = 'image-off-outline',
  blurRadius,
  enforceEarlyResizing,
  onDisplay,
}: AppImageProps) {
  const [failed, setFailed] = useState(!uri);

  useEffect(() => setFailed(!uri), [uri]);

  return (
    <View style={[styles.frame, style]}>
      {!failed && uri ? (
        <Image
          accessible={Boolean(accessibilityLabel)}
          accessibilityLabel={accessibilityLabel}
          cachePolicy="memory-disk"
          blurRadius={blurRadius}
          contentFit={contentFit}
          enforceEarlyResizing={enforceEarlyResizing}
          onDisplay={onDisplay}
          onError={() => setFailed(true)}
          placeholder={{ blurhash: NEUTRAL_BLURHASH }}
          placeholderContentFit="cover"
          priority={priority}
          recyclingKey={recyclingKey}
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          transition={transition}
        />
      ) : (
        <View accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel} style={styles.fallback}>
          <MaterialCommunityIcons
            accessible={false}
            color={theme.colors.textSoft}
            name={fallbackIcon}
            size={theme.icon.lg}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  fallback: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
});
