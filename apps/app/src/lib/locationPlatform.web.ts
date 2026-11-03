import type { CivicLocationPlatform } from '@politmus/core/civicLocation'
import * as Location from 'expo-location'

// Same key as the Vite web app, so both builds remember one address.
const STORAGE_KEY = 'politmus:address'

class LocationDenied extends Error {}

export const locationPlatform: CivicLocationPlatform = {
  readStoredAddress() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY)
      return value && value.trim() ? value : null
    } catch {
      return null
    }
  },
  writeStoredAddress(value) {
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, value)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Private mode or blocked storage: the address just won't survive a reload.
    }
  },
  canLocate: () => typeof navigator !== 'undefined' && 'geolocation' in navigator,
  async locationGranted() {
    try {
      const { granted } = await Location.getForegroundPermissionsAsync()
      return granted
    } catch {
      return false
    }
  },
  async currentPosition() {
    const { granted } = await Location.requestForegroundPermissionsAsync()
    if (!granted) throw new LocationDenied()
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    return { lat: position.coords.latitude, lon: position.coords.longitude }
  },
  locationErrorMessage(err) {
    if (err instanceof LocationDenied) return 'Location access was blocked. Enter your address instead.'
    return "Couldn't determine your location. Enter your address instead."
  },
}
