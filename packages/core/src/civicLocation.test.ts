import { describe, expect, it } from 'vitest'

import { lookupPath, placeLabel, sameAddress } from './civicLocation'

describe('civic location helpers', () => {
  it('looks up a point by rounded coordinates and an address by text', () => {
    expect(lookupPath({ kind: 'point', point: { lat: 30.2672149, lon: -97.7430608 }, address: null })).toBe(
      '/api/lookup?lat=30.26721&lon=-97.74306',
    )
    expect(lookupPath({ kind: 'address', address: '1100 Congress Ave, Austin' })).toBe(
      '/api/lookup?address=1100%20Congress%20Ave%2C%20Austin',
    )
  })

  it('labels a device location with the nearby address when known', () => {
    expect(placeLabel({ kind: 'point', point: { lat: 1, lon: 2 }, address: '1 Main St' })).toBe(
      'your current location (near 1 Main St)',
    )
    expect(placeLabel({ kind: 'point', point: { lat: 1, lon: 2 }, address: null })).toBe('your current location')
  })

  it('compares addresses ignoring case and spacing', () => {
    expect(sameAddress(' 1 Main  St ', '1 main st')).toBe(true)
    expect(sameAddress('1 Main St', null)).toBe(false)
  })
})
