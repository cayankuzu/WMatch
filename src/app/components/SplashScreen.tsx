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
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
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
    gap: 12,
  },
  logo: {
    maxWidth: '92%',
  },
  tagline: {
    color: theme.colors.textSoft,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
});
