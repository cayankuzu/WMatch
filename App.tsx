import 'react-native-url-polyfill/auto';

import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ExpoSplashScreen from 'expo-splash-screen';
import * as Sentry from '@sentry/react-native';

import AppRoot from './src/app/App';
import { telemetry } from './src/services/telemetry';

void ExpoSplashScreen.preventAutoHideAsync().catch(() => undefined);

function App() {
  const handleRootLayout = useCallback(() => {
    // The React splash is painted before the native splash is released, avoiding
    // a blank frame while auth/session cache restoration completes.
    void ExpoSplashScreen.hideAsync().catch(() => undefined);
    telemetry.markStartupMilestone('react_first_layout');
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.root} onLayout={handleRootLayout}>
        <SafeAreaProvider>
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
