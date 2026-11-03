import { describe, expect, it } from 'vitest'

import type { VoterLocation } from './types'
import { formatMiles, milesBetween, rankSites } from './votingSites'

function site(name: string, latitude?: number, longitude?: number): VoterLocation {
  return {
    locationName: name,
    line1: null,
    city: null,
    state: null,
    zip: null,
    pollingHours: null,
    startDate: null,
    endDate: null,
    notes: null,
    latitude,
    longitude,
    sources: [],
  }
}

const AUSTIN_CAPITOL = { lat: 30.2747, lon: -97.7404 }

describe('rankSites', () => {
  it('puts the nearest sites first and unplaced sites last', () => {
    const ranked = rankSites(
      [site('Far', 30.5, -97.9), site('No coords'), site('Near', 30.275, -97.741)],
      AUSTIN_CAPITOL,
    )
    expect(ranked.map((r) => r.location.locationName)).toEqual(['Near', 'Far', 'No coords'])
    expect(ranked[0].miles).toBeLessThan(0.2)
    expect(ranked[2].miles).toBeNull()
  })

  it('keeps the API order without a voter point', () => {
    const ranked = rankSites([site('B', 1, 1), site('A', 2, 2)], null)
    expect(ranked.map((r) => r.location.locationName)).toEqual(['B', 'A'])
    expect(ranked.every((r) => r.miles === null)).toBe(true)
  })
})

describe('milesBetween', () => {
  it('measures Austin to Dallas at about 182 miles', () => {
    expect(milesBetween(AUSTIN_CAPITOL, { lat: 32.7767, lon: -96.797 })).toBeCloseTo(182, -1)
  })
})

describe('formatMiles', () => {
  it('shows a decimal under 10 miles', () => {
    expect(formatMiles(0.42)).toBe('0.4 mi')
    expect(formatMiles(12.6)).toBe('13 mi')
  })
})
