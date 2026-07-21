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
  const fontsReady = fontsLoaded || Boolean(fontError);

  const handleRootLayout = useCallback(() => {
    if (!fontsReady) {
      return;
    }

    // The React splash is painted before the native splash is released, avoiding
    // a blank frame while auth/session cache restoration completes.
    void ExpoSplashScreen.hideAsync().catch(() => undefined);
    telemetry.markStartupMilestone('react_first_layout');
  }, [fontsReady]);

  useEffect(() => {
    if (fontsReady) {
      void ExpoSplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return null;
  }

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
