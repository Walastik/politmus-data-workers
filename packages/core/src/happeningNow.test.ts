import { describe, expect, it } from 'vitest'

import {
  ballotRacesFor,
  beforeYouVoteLinks,
  candidateBackground,
  daysAwayLabel,
  districtLabel,
  electionHeadline,
  formatClockTime,
  formatCountdown,
  houseDistrict,
  isElectionFocus,
  moreSitesNote,
  pollsCloseFor,
  uniqueCandidates,
  votingSitesView,
} from './happeningNow'
import type { CivicLookup, Race, RaceCandidate, VoterInfo, VoterLocation } from './types'

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
  } as VoterLocation
}

function voterInfo(partial: Partial<VoterInfo>): VoterInfo {
  return {
    uiState: 'ready',
    upstreamStatus: 'ok',
    election: null,
    mailOnly: false,
    pollingLocations: [],
    earlyVoteSites: [],
    dropOffLocations: [],
    adminBodies: { state: null, local: null },
    otherElections: [],
    fetchedAt: '2026-10-29T00:00:00Z',
    ...partial,
  } as VoterInfo
}

const window = { start: '2026-10-20', end: '2026-11-03', electionDate: '2026-11-03', sourceName: 'SOS', sourceUrl: 'https://sos.example' }

describe('houseDistrict and districtLabel', () => {
  it('reads the district from the cd division, with 0 as at-large', () => {
    const lookup = { divisions: [{ ocd_id: 'ocd-division/country:us/state:tx' }, { ocd_id: 'ocd-division/country:us/state:tx/cd:7' }] }
    expect(houseDistrict(lookup as unknown as CivicLookup)).toBe(7)
    expect(houseDistrict(null)).toBeNull()
    expect(districtLabel('TX', 7)).toBe('TX-7')
    expect(districtLabel('AK', 0)).toBe('AK-AL')
    expect(districtLabel(null, 7)).toBeNull()
  })
})

describe('isElectionFocus and daysAwayLabel', () => {
  it('focuses on the election within 60 days', () => {
    expect(isElectionFocus(0)).toBe(true)
    expect(isElectionFocus(60)).toBe(true)
    expect(isElectionFocus(61)).toBe(false)
    expect(isElectionFocus(-1)).toBe(false)
    expect(isElectionFocus(null)).toBe(false)
    expect(daysAwayLabel(0)).toBe('Today')
    expect(daysAwayLabel(1)).toBe('Tomorrow')
    expect(daysAwayLabel(5)).toBe('5 days away')
    expect(daysAwayLabel(-2)).toBeNull()
  })
})

describe('electionHeadline', () => {
  it('follows the early voting phase', () => {
    expect(
      electionHeadline({ window, phase: { phase: 'upcoming', daysUntil: 1 }, stateName: 'Texas', openStateCount: 0, electionName: null }),
    ).toMatchObject({ headline: expect.stringContaining('Early voting in Texas starts'), detail: 'That’s tomorrow.' })
    expect(
      electionHeadline({ window, phase: { phase: 'ended' }, stateName: 'Texas', openStateCount: 0, electionName: null }).headline,
    ).toBe('Early voting in Texas has ended')
    const open = electionHeadline({ window, phase: { phase: 'open' }, stateName: 'Texas', openStateCount: 0, electionName: null })
    expect(open.headline).toBe('Early voting is open in Texas')
    expect(open.endLabel).toBe('Election Day')
  })

  it('leads with Election Day, with the closing time once sites load', () => {
    const base = { window, phase: { phase: 'ended' } as const, stateName: 'Texas', openStateCount: 0, electionName: null }
    const withClose = electionHeadline({
      ...base,
      electionDay: true,
      pollsClose: { at: new Date(2026, 10, 3, 19, 0), siteName: 'Sam Houston Building' },
    })
    expect(withClose.headline).toBe('Today is Election Day!')
    expect(withClose.detail).toBe('Your closest polling place closes at 7 pm. If you’re in line by then, you can still vote.')
    expect(electionHeadline({ ...base, electionDay: true }).detail).toContain('before your polling place closes tonight')
    expect(electionHeadline({ ...base, stateName: null, electionDay: true }).detail).toContain('Add your address')
    // Early voting that runs through Election Day still gives way to it.
    expect(electionHeadline({ ...base, phase: { phase: 'open' }, electionDay: true }).headline).toBe('Today is Election Day!')
  })

  it('falls back to the count of open states, then the election name', () => {
    expect(
      electionHeadline({ window: null, phase: null, stateName: null, openStateCount: 30, electionName: null }).headline,
    ).toBe('Early voting is open in 30 states')
    expect(
      electionHeadline({ window: null, phase: null, stateName: null, openStateCount: 0, electionName: 'General Election' }),
    ).toEqual({ headline: 'General Election', detail: null, endLabel: null })
  })
})

describe('votingSitesView', () => {
  const data = voterInfo({
    earlyVoteSites: [site('A', 30.1, -97.1), site('B', 30.5, -97.5), site('C', 31, -98), site('D', 32, -99)],
    pollingLocations: [site('Polls')],
  })

  it('shows the closest early sites while early voting is on', () => {
    const view = votingSitesView(data, { phase: 'open' }, { lat: 30, lon: -97 })
    expect(view.kind).toBe('early')
    expect(view.title).toBe('Closest early voting sites')
    expect(view.shown.map((s) => s.location.locationName)).toEqual(['A', 'B', 'C'])
    expect(view.totalSites).toBe(5)
    expect(moreSitesNote(view)).toBe('By straight-line distance from your address. 1 more early voting sites nearby.')
  })

  it('switches to polling places once early voting has ended', () => {
    const view = votingSitesView(data, { phase: 'ended' }, null)
    expect(view.kind).toBe('polling')
    expect(view.title).toBe('Election Day polling places')
    expect(moreSitesNote(view)).toBeNull()
  })

  it('shows polling places on Election Day even while early voting runs through it', () => {
    expect(votingSitesView(data, { phase: 'open' }, null, true).kind).toBe('polling')
  })
})

describe('pollsCloseFor', () => {
  const hours = (location: VoterLocation, pollingHours: string) => ({ ...location, pollingHours })

  it('uses the closest polling place with hours for Election Day', () => {
    const data = voterInfo({
      pollingLocations: [
        hours(site('Far', 31, -98), 'Tue, Nov 3: 7 am - 8 pm'),
        hours(site('Near', 30.01, -97.01), 'Tue, Nov 3: 7 am - 7 pm'),
        site('Nearest, no hours', 30, -97),
      ],
    })
    expect(pollsCloseFor(data, { lat: 30, lon: -97 }, '2026-11-03')).toEqual({
      at: new Date(2026, 10, 3, 19, 0),
      siteName: 'Near',
    })
  })

  it('counts early sites only when their hours name Election Day', () => {
    const undated = voterInfo({ earlyVoteSites: [hours(site('Center'), '8 am - 5 pm')] })
    expect(pollsCloseFor(undated, null, '2026-11-03')).toBeNull()
    const dated = voterInfo({
      earlyVoteSites: [hours(site('Center'), 'Mon, Nov 2: 8 am - 5 pm\nTue, Nov 3: 7 am - 8:30 pm')],
    })
    expect(pollsCloseFor(dated, null, '2026-11-03')?.at).toEqual(new Date(2026, 10, 3, 20, 30))
  })

  it('is null without sites or hours', () => {
    expect(pollsCloseFor(null, null, '2026-11-03')).toBeNull()
    expect(pollsCloseFor(voterInfo({ pollingLocations: [site('A')] }), null, '2026-11-03')).toBeNull()
  })

  it('formats the closing time and the countdown', () => {
    expect(formatClockTime(new Date(2026, 10, 3, 19, 0))).toBe('7 pm')
    expect(formatClockTime(new Date(2026, 10, 3, 20, 30))).toBe('8:30 pm')
    expect(formatCountdown((2 * 3600 + 5 * 60 + 9) * 1000)).toBe('2h 05m 09s')
    expect(formatCountdown((5 * 60 + 9) * 1000 + 400)).toBe('5m 09s')
    expect(formatCountdown(0)).toBeNull()
  })
})

describe('ballot races', () => {
  const candidate = (name: string, party: string, id: string) =>
    ({ fec_candidate_id: id, name, party, background: null }) as unknown as RaceCandidate

  it('keeps Senate races and the visitor’s House district', () => {
    const races = [
      { key: 's', office: 'S', district: 0 },
      { key: 'h7', office: 'H', district: 7 },
      { key: 'h8', office: 'H', district: 8 },
    ] as Race[]
    expect(ballotRacesFor(races, 7).map((r) => r.key)).toEqual(['s', 'h7'])
  })

  it('lists one campaign filed under two FEC IDs once', () => {
    const race = { candidates: [candidate('Ann Lee', 'D', '1'), candidate('ANN LEE', 'D', '2'), candidate('Bo Ray', 'R', '3')] } as Race
    expect(uniqueCandidates(race).map((c) => c.fec_candidate_id)).toEqual(['1', '3'])
  })

  it('drops generic backgrounds and capitalizes the rest', () => {
    const c = { background: ['politician', 'teacher', 'veteran', 'farmer'] } as unknown as RaceCandidate
    expect(candidateBackground(c)).toEqual(['Teacher', 'Veteran'])
  })
})

describe('beforeYouVoteLinks', () => {
  it('prefers the local office and skips links with no URL', () => {
    const body = {
      name: 'Travis County Clerk',
      electionRegistrationConfirmationUrl: 'https://local/registered',
      ballotInfoUrl: null,
      votingLocationFinderUrl: null,
      absenteeVotingInfoUrl: null,
      phone: '512-555-0100',
    }
    const { links, office } = beforeYouVoteLinks(
      voterInfo({ adminBodies: { local: body, state: null } as unknown as VoterInfo['adminBodies'] }),
      'TX',
    )
    expect(links[0]).toEqual({ label: 'Check that you’re registered', url: 'https://local/registered' })
    expect(links.find((l) => l.label === 'See your sample ballot')).toBeUndefined()
    expect(office?.name).toBe('Travis County Clerk')
  })
})
