type ExpoLocationModule = typeof import('expo-location');

async function loadLocationModule(): Promise<ExpoLocationModule | null> {
  try {
    return await import('expo-location');
  } catch (error) {
    console.warn('Location services are unavailable in this build:', error);
    return null;
  }
}

export async function requestForegroundLocation() {
  const Location = await loadLocationModule();

  if (!Location) {
    throw new Error('Konum ozelligi bu build icinde kullanilamiyor. Yeni native build gerekli.');
  }

  const servicesEnabled =
    typeof Location.hasServicesEnabledAsync === 'function'
      ? await Location.hasServicesEnabledAsync()
      : true;

  if (!servicesEnabled) {
    throw new Error('Konum servisleri kapali. Mesafe filtresi icin cihaz konumunu acmalisin.');
  }

  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    throw new Error('Mesafe filtresi icin konum izni vermelisin.');
  }

  const lastKnownPosition =
    typeof Location.getLastKnownPositionAsync === 'function'
      ? await Location.getLastKnownPositionAsync({
          maxAge: 15 * 60 * 1000,
          requiredAccuracy: 5000,
        }).catch(() => null)
      : null;

  const position =
    lastKnownPosition ??
    await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    timestamp: new Date(position.timestamp).toISOString(),
  };
}
