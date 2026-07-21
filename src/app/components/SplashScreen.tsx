import { Image } from 'expo-image';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '../../shared/theme';
import { useLocalization } from '../../context/LocalizationContext';
import AuthFooter from './ui/AuthFooter';

export default function SplashScreen() {
  const { t } = useLocalization();
  const { width, height } = useWindowDimensions();
  const logoAspectRatio = 320 / 190;
  const targetWidth = Math.min(width - 48, 320);
  const targetHeight = targetWidth / logoAspectRatio;
  const logoHeight = Math.min(targetHeight, height * 0.32);
  const logoWidth = logoHeight * logoAspectRatio;

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safeArea}>
      <View
        accessibilityLabel={t('a11y.wmatchLoading')}
        accessibilityLiveRegion="polite"
        style={styles.container}
      >
        <View style={styles.stage}>
          <View style={styles.logoShell}>
            <Image
              accessible={false}
              source={require('../../../assets/branding/splash-logo-main.png')}
              contentFit="contain"
              style={[styles.logo, { width: logoWidth, height: logoHeight }]}
            />
            <Text style={styles.tagline}>Watch Match</Text>
            <View style={styles.brandSignal} />
          </View>
        </View>

        <AuthFooter />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.black,
  },
  container: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: theme.colors.black,
    paddingVertical: 30,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoShell: {
    alignItems: 'center',
    gap: 10,
  },
  logo: {
    maxWidth: '92%',
  },
  tagline: {
    color: theme.colors.textSoft,
    ...theme.typography.roles.meta,
    fontFamily: theme.fonts.semibold,
    letterSpacing: 0.2,
  },
  brandSignal: {
    width: 42,
    height: 3,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
});
