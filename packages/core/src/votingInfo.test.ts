import { describe, expect, it } from 'vitest'

import { electionOffices, locationGroups, registrationLinks, showStaticFallback, staticFallback, votingNotice } from './votingInfo'
import type { AdminBodies, VoterInfo, VoterLocation } from './types'

const site = { locationName: 'Library' } as VoterLocation
const info = (partial: Partial<VoterInfo>) =>
  ({
    uiState: 'live',
    election: { name: 'General Election', date: '2026-11-03' },
    pollingLocations: [],
    earlyVoteSites: [],
    dropOffLocations: [],
    adminBodies: { local: null, state: null },
    ...partial,
  }) as unknown as VoterInfo

describe('voting info', () => {
  it('lists the site groups that have sites', () => {
    expect(locationGroups(info({ pollingLocations: [site], dropOffLocations: [site] })).map((g) => g.typeLabel)).toEqual([
      'Election Day',
      'Drop-off Box',
    ])
    expect(locationGroups(info({ uiState: 'mail_only', pollingLocations: [site], dropOffLocations: [site] })).map((g) => g.typeLabel)).toEqual([
      'Drop-off Box',
    ])
  })

  it('explains each state without sites', () => {
    expect(votingNotice(info({}), 'TX')).toBeNull()
    const notYet = votingNotice(info({ uiState: 'no_locations_yet' }), 'TX')
    expect(notYet?.title).toBe("Voting locations for this address aren't in our data yet")
    expect(notYet?.action?.label).toBe("Find your voting location on Texas's official site")
    expect(votingNotice(info({ uiState: 'address_problem' }), null)?.tone).toBe('error')
  })

  it('prefers the local office’s links and shows fallbacks when live data has none', () => {
    const adminBodies = {
      local: { name: 'County', electionRegistrationUrl: 'https://local/register' },
      state: { name: 'State', electionRegistrationUrl: 'https://state/register', ballotInfoUrl: 'https://state/ballot' },
    } as unknown as AdminBodies
    expect(registrationLinks(adminBodies).map((l) => l.url)).toEqual(['https://local/register', 'https://state/ballot'])
    expect(electionOffices(adminBodies).map((o) => o.role)).toEqual(['Your local election office', 'State election office'])
    expect(showStaticFallback(info({}))).toBe(true)
    expect(showStaticFallback(info({ adminBodies }))).toBe(false)
  })

  it('always offers Vote.org and Vote.gov', () => {
    const fallback = staticFallback(null)
    expect(fallback.links.some((l) => l.label.includes('Vote.org'))).toBe(true)
    expect(fallback.links.at(-1)?.label).toBe('Federal Guide (Vote.gov)')
  })
})
