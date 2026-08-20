import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Image,
  type ImageContentFit,
  type ImageProps,
  type ImageStyle,
} from 'expo-image';
import { Pressable, StyleSheet, View, type StyleProp } from 'react-native';

import {
  getConnectivitySnapshot,
  subscribeToConnectivity,
} from '../../../services/connectivity';
import { theme } from '../../../shared/theme';

const MANAGED_PROFILE_PHOTO_PATTERN = /\/storage\/v1\/object\/(?:sign|public)\/profile-photos\/([^?]+)/i;
const RETRY_DELAYS_MS = [450, 1_200] as const;

export function getStableImageCacheKey(uri: string) {
  const managedPhotoPath = uri.match(MANAGED_PROFILE_PHOTO_PATTERN)?.[1];
  return managedPhotoPath ? `profile-photo:${managedPhotoPath}` : undefined;
}

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
  enforceEarlyResizing = true,
  onDisplay,
}: AppImageProps) {
  const [failed, setFailed] = useState(!uri);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableCacheKey = useMemo(() => uri ? getStableImageCacheKey(uri) : undefined, [uri]);

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    if (!uri) {
      return;
    }

    cancelRetry();
    const delay = RETRY_DELAYS_MS[retryAttempt];
    if (delay == null) {
      setFailed(true);
      return;
    }

    setFailed(true);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryAttempt((current) => current + 1);
      setFailed(false);
    }, delay);
  }, [cancelRetry, retryAttempt, uri]);

  const retryImmediately = useCallback(() => {
    if (!uri) {
      return;
    }

    cancelRetry();
    setRetryAttempt(0);
    setFailed(false);
  }, [cancelRetry, uri]);

  useEffect(() => {
    cancelRetry();
    setFailed(!uri);
    setRetryAttempt(0);
    return cancelRetry;
  }, [cancelRetry, uri]);

  useEffect(() => {
    if (!failed || !uri) {
      return;
    }

    return subscribeToConnectivity(() => {
      const connectivity = getConnectivitySnapshot();
      if (connectivity.connected && connectivity.internetReachable) {
        retryImmediately();
      }
    });
  }, [failed, retryImmediately, uri]);

  const handleDisplay = useCallback<NonNullable<ImageProps['onDisplay']>>(() => {
    cancelRetry();
    setFailed(false);
    onDisplay?.();
  }, [cancelRetry, onDisplay]);

  return (
    <View style={[styles.frame, style]}>
      {!failed && uri ? (
        <Image
          key={`${uri}:${retryAttempt}`}
          accessible={Boolean(accessibilityLabel)}
          accessibilityLabel={accessibilityLabel}
          cachePolicy="memory-disk"
          blurRadius={blurRadius}
          contentFit={contentFit}
          enforceEarlyResizing={enforceEarlyResizing}
          onDisplay={handleDisplay}
          onError={() => retry()}
          priority={priority}
          recyclingKey={recyclingKey ?? stableCacheKey ?? uri}
          source={{ uri, cacheKey: stableCacheKey }}
          style={StyleSheet.absoluteFill}
          transition={transition}
        />
      ) : (
        <Pressable
          accessible={Boolean(accessibilityLabel)}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole={uri ? 'button' : 'image'}
          disabled={!uri}
          onPress={retryImmediately}
          style={({ pressed }) => [styles.fallback, pressed && styles.fallbackPressed]}
        >
          <MaterialCommunityIcons
            accessible={false}
            color={theme.colors.textSoft}
            name={fallbackIcon}
            size={theme.icon.lg}
          />
        </Pressable>
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
  fallbackPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
});
