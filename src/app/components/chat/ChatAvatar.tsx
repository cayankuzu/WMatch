import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { theme } from '../../../shared/theme';
import AppImage from '../ui/AppImage';

interface ChatAvatarProps {
  uri: string | null;
  size: number;
  bordered?: boolean;
}

export default function ChatAvatar({ uri, size, bordered = false }: ChatAvatarProps) {
  const frameStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: bordered ? 2 : 1,
    borderColor: bordered ? theme.colors.primary : theme.alpha.brand18,
  } as const;

  if (uri) {
    return (
      <AppImage
        contentFit="cover"
        fallbackIcon="account-outline"
        recyclingKey={uri}
        uri={uri}
        style={frameStyle}
        transition={theme.motion.fast}
      />
    );
  }

  return (
    <View accessible={false} style={[styles.fallback, frameStyle]}>
      <MaterialCommunityIcons
        accessible={false}
        name="account-outline"
        size={size * 0.38}
        color={theme.colors.primarySoft}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySurface,
  },
});
