import type { VoterLocation } from './types'

export interface Point {
  lat: number
  lon: number
}

export interface RankedSite {
  location: VoterLocation
  // Straight-line miles from the voter, or null when either point is unknown.
  miles: number | null
}

const EARTH_RADIUS_MILES = 3958.8

export function milesBetween(a: Point, b: Point): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

function sitePoint(location: VoterLocation): Point | null {
  const { latitude, longitude } = location
  return typeof latitude === 'number' && typeof longitude === 'number'
    ? { lat: latitude, lon: longitude }
    : null
}

// Sites nearest the voter first. Sites without coordinates keep the Civic API's
// order after the ones we could place; with no voter point, the order is unchanged.
export function rankSites(locations: VoterLocation[], from: Point | null | undefined): RankedSite[] {
  const ranked = locations.map((location, index) => {
    const point = sitePoint(location)
    return { location, index, miles: from && point ? milesBetween(from, point) : null }
  })
  ranked.sort((a, b) => {
    if (a.miles === null || b.miles === null) {
      return a.miles === b.miles ? a.index - b.index : a.miles === null ? 1 : -1
    }
    return a.miles - b.miles
  })
  return ranked.map(({ location, miles }) => ({ location, miles }))
}

export function formatMiles(miles: number): string {
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`
}

export function locationAddress(location: VoterLocation): string {
  return [location.line1, location.city, [location.state, location.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
}

export function directionsUrl(location: VoterLocation): string | null {
  const address = locationAddress(location)
  return address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
    : null
}
