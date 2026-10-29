// Browser geolocation. Address search and reverse geocoding live in
// @politmus/core/geo.

export function canUseGeolocation() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 300000,
    }),
  )
}

// True only when the visitor already allowed location for this site, so we can
// use it without a permission prompt.
export async function geolocationGranted(): Promise<boolean> {
  if (!canUseGeolocation() || !navigator.permissions?.query) return false
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state === 'granted'
  } catch {
    return false
  }
}

export function geolocationErrorMessage(err: unknown) {
  if (err && typeof err === 'object' && 'code' in err) {
    if (err.code === 1) {
      return 'Location access was blocked. Enter your address instead.'
    }
    if (err.code === 3) {
      return 'Finding your location took too long. Try again or enter your address.'
    }
  }
  return "Couldn't determine your location. Enter your address instead."
}
