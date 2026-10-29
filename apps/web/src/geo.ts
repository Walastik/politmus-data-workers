export interface Point {
  lat: number
  lon: number
}

export interface PhotonResult {
  formattedAddress: string
  coordinates: [number, number]
}

const REVERSE_GEOCODE_TIMEOUT_MS = 5000

export function formatPhotonFeature(feature: any): PhotonResult {
  const props = feature.properties
  const addressLine1 = [props.housenumber, props.street].filter(Boolean).join(' ')
  const parts = [addressLine1, props.city, props.state, props.postcode].filter(Boolean)
  return {
    formattedAddress: parts.join(', '),
    coordinates: feature.geometry.coordinates,
  }
}

// ~1 m precision is plenty for district lookup and avoids sending more than needed.
export function roundCoordinate(value: number) {
  return Math.round(value * 1e5) / 1e5
}

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

// Best effort: a street address for a point, used for display and for voting
// sites. Representatives come from the coordinates themselves.
export async function reverseGeocode(point: Point): Promise<string | null> {
  try {
    const res = await fetch(
      `https://photon.komoot.io/reverse?lat=${point.lat}&lon=${point.lon}&limit=1`,
      { signal: AbortSignal.timeout(REVERSE_GEOCODE_TIMEOUT_MS) },
    )
    if (!res.ok) return null
    const data = await res.json()
    const feature = data.features?.[0]
    if (!feature || feature.properties?.countrycode !== 'US') return null
    const { formattedAddress } = formatPhotonFeature(feature)
    // A house number is what lets Google Civic find a polling place.
    return feature.properties.housenumber && formattedAddress ? formattedAddress : null
  } catch (err) {
    console.error('Photon reverse lookup failed', err)
    return null
  }
}

export async function suggestAddresses(query: string, signal?: AbortSignal): Promise<PhotonResult[]> {
  const res = await fetch(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&countrycode=US&limit=5`,
    { signal },
  )
  const data = await res.json()
  return (data.features || []).map(formatPhotonFeature)
}
