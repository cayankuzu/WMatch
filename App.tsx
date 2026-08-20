import 'react-native-url-polyfill/auto';

import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ExpoSplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/inter';

import AppRoot from './src/app/App';
import { telemetry } from './src/services/telemetry';

void ExpoSplashScreen.preventAutoHideAsync().catch(() => undefined);

function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  useEffect(() => {
    if (fontError) {
      telemetry.captureException(fontError, { operation: 'font_bootstrap' });
    }
  }, [fontError]);

  const handleRootLayout = useCallback(() => {
    // Session/cache bootstrap must not wait for a presentation-only resource.
    // Fonts are embedded in native builds; useFonts remains a development fallback.
    void ExpoSplashScreen.hideAsync().catch(() => undefined);
    telemetry.markStartupMilestone('react_first_layout', { fontsLoaded });
  }, [fontsLoaded]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.root} onLayout={handleRootLayout}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <StatusBar style="light" />
          <AppRoot />
        </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
