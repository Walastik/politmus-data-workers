// Address search and reverse geocoding (Photon, OpenStreetMap). Plain fetch,
// so it runs on web and React Native alike.

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

// Best effort: a street address for a point, used for display and for voting
// sites. Representatives come from the coordinates themselves.
export async function reverseGeocode(point: Point): Promise<string | null> {
  // AbortSignal.timeout isn't in every React Native runtime.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS)
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${point.lat}&lon=${point.lon}&limit=1`, {
      signal: controller.signal,
    })
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
  } finally {
    clearTimeout(timer)
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
