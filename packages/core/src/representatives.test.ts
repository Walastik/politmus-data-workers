import { describe, expect, it } from 'vitest'

import { representativeDistrict, representativeState, websiteLabel } from './representatives'
import type { CivicRepresentative } from './types'

const rep = (division_id: string, division_name: string) => ({ division_id, division_name }) as CivicRepresentative

describe('representative labels', () => {
  it('names the district for district seats and the state for statewide ones', () => {
    const house = rep('ocd-division/country:us/state:tx/cd:7', 'Texas’s 7th district')
    const governor = rep('ocd-division/country:us/state:tx', 'Texas')
    expect(representativeDistrict(house)).toBe('Texas’s 7th district')
    expect(representativeState(house, 'Texas')).toBe('Texas')
    expect(representativeDistrict(governor)).toBeNull()
    expect(representativeState(governor, 'Fallback')).toBe('Texas')
  })

  it('shortens a website to its host', () => {
    expect(websiteLabel('https://www.cruz.senate.gov/contact')).toBe('cruz.senate.gov')
    expect(websiteLabel('not a url')).toBe('not a url')
  })
})
