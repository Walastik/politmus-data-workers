import {
  CivicLocationProvider as SharedCivicLocationProvider,
  type CivicLocationPlatform,
} from '@politmus/core/civicLocation'
import type { ReactNode } from 'react'

import { api } from './api'
import { canUseGeolocation, geolocationErrorMessage, geolocationGranted, getCurrentPosition } from './geo'
import { useSavedAddress } from './useSavedAddress'

export { useCivicLocation, type CivicLocation, type Load, type Place } from '@politmus/core/civicLocation'

const STORAGE_KEY = 'politmus:address'

// The browser side of the shared location provider: localStorage and
// navigator.geolocation.
const webPlatform: CivicLocationPlatform = {
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
  canLocate: canUseGeolocation,
  locationGranted: geolocationGranted,
  async currentPosition() {
    const position = await getCurrentPosition()
    return { lat: position.coords.latitude, lon: position.coords.longitude }
  },
  locationErrorMessage: geolocationErrorMessage,
}

export function CivicLocationProvider({ children }: { children: ReactNode }) {
  const saved = useSavedAddress()
  return (
    <SharedCivicLocationProvider api={api} platform={webPlatform} saved={saved}>
      {children}
    </SharedCivicLocationProvider>
  )
}
