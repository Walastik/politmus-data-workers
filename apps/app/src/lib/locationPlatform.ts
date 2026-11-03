import type { CivicLocationPlatform } from '@politmus/core/civicLocation'
import * as Location from 'expo-location'
import * as SecureStore from 'expo-secure-store'

const STORAGE_KEY = 'politmus.address'

class LocationDenied extends Error {}

// The native side of the shared location provider: SecureStore (synchronous,
// so the first render knows the address) and expo-location.
export const locationPlatform: CivicLocationPlatform = {
  readStoredAddress() {
    try {
      const value = SecureStore.getItem(STORAGE_KEY)
      return value && value.trim() ? value : null
    } catch {
      return null
    }
  },
  writeStoredAddress(value) {
    if (value) {
      SecureStore.setItem(STORAGE_KEY, value)
    } else {
      SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => {})
    }
  },
  canLocate: () => true,
  async locationGranted() {
    const { granted } = await Location.getForegroundPermissionsAsync()
    return granted
  },
  async currentPosition() {
    const { granted } = await Location.requestForegroundPermissionsAsync()
    if (!granted) throw new LocationDenied()
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return { lat: position.coords.latitude, lon: position.coords.longitude }
  },
  locationErrorMessage(err) {
    if (err instanceof LocationDenied) {
      return 'Location access is off for Politmus. Enter your address, or allow location in Settings.'
    }
    return "Couldn't determine your location. Enter your address instead."
  },
}
