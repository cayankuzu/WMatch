import { Image } from 'expo-image';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { theme } from '../../../shared/theme';

interface AuthWordmarkProps {
  variant?: 'default' | 'splash';
}

export default function AuthWordmark({
  variant = 'default',
}: AuthWordmarkProps) {
  const isSplash = variant === 'splash';
  const { width, height } = useWindowDimensions();
  const logoAspectRatio = 120 / 196;
  const targetWidth = Math.min(width - 40, isSplash ? 100 : 74);
  const targetHeight = targetWidth / logoAspectRatio;
  const maxLogoHeight = isSplash ? height * 0.26 : height * 0.2;
  const logoHeight = Math.min(targetHeight, maxLogoHeight);
  const logoWidth = logoHeight * logoAspectRatio;

  return (
    <View style={[styles.container, isSplash && styles.containerSplash]}>
      <Image
        accessible={false}
        source={require('../../../../assets/branding/logo-wm-stacked.png')}
        contentFit="contain"
        style={[styles.logo, { width: logoWidth, height: logoHeight }]}
      />
      <Text style={[styles.wordmark, isSplash && styles.wordmarkSplash]}>WMatch</Text>
      <Text style={[styles.tagline, isSplash && styles.taglineSplash]}>Watch Match</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
  },
  containerSplash: {
    gap: 10,
  },
  logo: {
    borderRadius: theme.radius.md,
  },
  wordmark: {
    color: theme.colors.text,
    fontSize: 24,
    fontFamily: theme.fonts.extraBold,
    letterSpacing: 0,
  },
  wordmarkSplash: {
    fontSize: 28,
  },
  tagline: {
    color: theme.colors.textSoft,
    fontSize: theme.typography.body,
    fontFamily: theme.fonts.bold,
    letterSpacing: 0,
  },
  taglineSplash: {
    fontSize: theme.typography.body,
  },
});
