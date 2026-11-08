import { describe, expect, it } from 'vitest'

import {
  chamberControl,
  chamberNotes,
  chamberOutlook,
  congressNotes,
  controlHeadline,
  raceStatus,
  raceWinner,
  statusLine,
  isAggregated,
  resultsLinkPhase,
  snapshotRequestUrl,
  countingComplete,
  countyLabel,
  countyMatchKey,
  countyNameForFeature,
  countyStanding,
  countyTurnout,
  dollarsPerVote,
  formatMargin,
  formatMoney,
  formatSourceTime,
  houseFlips,
  houseTally,
  partyKey,
  partyTint,
  raceStanding,
  reportingLabel,
  resultHighlights,
  senateTally,
  type RaceResult,
  type ResultCandidate,
  type ResultsSnapshot,
  type StateResults,
} from './electionResults'

function candidate(name: string, party: string, votes: number, extra: Partial<ResultCandidate> = {}): ResultCandidate {
  return { name, party, votes, ...extra }
}

function race(partial: Partial<RaceResult> & Pick<RaceResult, 'candidates'>): RaceResult {
  return {
    office: 'S',
    district: 0,
    label: 'U.S. Senate',
    special: false,
    totalVotes: partial.candidates.reduce((sum, c) => sum + c.votes, 0),
    reporting: { done: 10, total: 10, unit: 'counties' },
    counties: {},
    ...partial,
  }
}

function state(code: string, races: RaceResult[], counties: StateResults['counties'] = {}): StateResults {
  return {
    state: code,
    name: code,
    source: { name: 'Secretary of State', url: 'https://example.gov', lastUpdated: null, fetchedAt: '', official: false },
    registered: null,
    ballots: null,
    counties,
    races,
  }
}

const profile = (receipts: number) => ({
  officialId: 'x',
  fecId: 'x',
  name: null,
  photoUrl: null,
  receipts,
  disbursements: null,
})

describe('raceStanding', () => {
  it('ranks by votes and measures the lead against all votes', () => {
    const standing = raceStanding(
      race({ candidates: [candidate('B', 'REP', 400), candidate('A', 'DEM', 550), candidate('Write-in', '', 50, { writeIn: true })] }),
    )
    expect(standing.leader?.name).toBe('A')
    expect(standing.runnerUp?.name).toBe('B')
    expect(standing.marginVotes).toBe(150)
    expect(standing.margin).toBeCloseTo(15)
  })

  it('drops write-in lines with no votes', () => {
    const standing = raceStanding(race({ candidates: [candidate('A', 'DEM', 10), candidate('Write-in', '', 0, { writeIn: true })] }))
    expect(standing.ranked).toHaveLength(1)
    expect(standing.runnerUp).toBeNull()
  })
})

describe('formatting', () => {
  it('formats margins, money and reporting', () => {
    expect(formatMargin(4.137)).toBe('+4.1')
    expect(formatMargin(18.4)).toBe('+18')
    expect(formatMoney(146_349_912)).toBe('$146M')
    expect(formatMoney(4_200_000)).toBe('$4.2M')
    expect(formatMoney(59_000)).toBe('$59K')
    expect(reportingLabel(race({ candidates: [] }))).toBe('All 10 counties reporting')
    expect(reportingLabel(race({ candidates: [], reporting: { done: 25, total: 64, unit: 'counties' } }))).toBe(
      '25 of 64 counties reporting',
    )
  })

  it('reads the time formats states publish', () => {
    expect(formatSourceTime('11/4/2026 9:16:43 AM MST')).toBe('Nov 4, 9:16 am MST')
    expect(formatSourceTime('11/3/2026 10:57:28 PM CST')).toBe('Nov 3, 10:57 pm CST')
    expect(formatSourceTime(null)).toBe('')
    expect(formatSourceTime('sometime')).toBe('sometime')
    expect(formatSourceTime('2026-11-04T09:18:34Z')).toMatch(/^Nov 4, \d{1,2}:18 (am|pm)$/)
  })

  it('tints by party and margin', () => {
    expect(partyKey('dem')).toBe('DEM')
    expect(partyKey('Working Families')).toBe('OTH')
    expect(partyTint('DEM', 30)).toBe('rgb(59, 130, 246)')
    expect(partyTint('DEM', 1)).not.toBe(partyTint('DEM', 30))
  })
})

describe('counties', () => {
  const senate = race({
    candidates: [candidate('A', 'DEM', 700), candidate('B', 'REP', 300)],
    counties: { Fulton: [600, 100], Appling: [100, 200] },
  })

  it('finds each county’s leader and margin', () => {
    expect(countyStanding(senate, 'Fulton')).toMatchObject({ leader: { name: 'A' }, totalVotes: 700 })
    expect(countyStanding(senate, 'Appling')?.leader?.name).toBe('B')
    expect(countyStanding(senate, 'Nowhere')).toBeNull()
  })

  it('computes turnout from registered voters and ballots', () => {
    const ga = state('GA', [senate], { Fulton: { registered: 1000, ballots: 600 }, Appling: { registered: 0, ballots: 5 } })
    expect(countyTurnout(ga, 'Fulton')).toBe(60)
    expect(countyTurnout(ga, 'Appling')).toBeNull()
  })

  it('names counties and independent cities', () => {
    expect(countyLabel({ state: 'GA' }, 'Fulton')).toBe('Fulton County, GA')
    expect(countyLabel({ state: 'VA' }, 'Alexandria city')).toBe('Alexandria, VA')
    expect(countyNameForFeature('51510', 'Alexandria')).toBe('Alexandria city')
    expect(countyNameForFeature('51059', 'Fairfax')).toBe('Fairfax')
    expect(countyMatchKey('St. Clair')).toBe(countyMatchKey('Saint Clair'))
    expect(countyMatchKey('DeKalb')).toBe(countyMatchKey('De Kalb'))
  })
})

describe('tallies and highlights', () => {
  const flip = race({
    office: 'H',
    district: 2,
    label: 'U.S. House District 2',
    candidates: [
      candidate('Challenger', 'DEM', 5010, { profile: profile(200_000) }),
      candidate('Sitting Member', 'REP', 4990, { incumbent: true, profile: profile(2_000_000) }),
    ],
  })
  const safe = race({
    office: 'H',
    district: 1,
    label: 'U.S. House District 1',
    candidates: [candidate('Safe', 'REP', 9000, { incumbent: true }), candidate('Long Shot', 'DEM', 1000)],
  })
  const senate = race({ candidates: [candidate('Senator', 'DEM', 6000, { profile: profile(600_000) }), candidate('Rival', 'REP', 4000)] })
  const va = state('VA', [senate, flip, safe], {
    Big: { registered: 10_000, ballots: 7_000 },
    Small: { registered: 5_000, ballots: 1_500 },
  })
  const snapshot: ResultsSnapshot = { election: { date: '2026-11-03', name: 'General' }, generatedAt: '', states: { VA: va } }

  it('tallies leads and flips', () => {
    expect(senateTally(snapshot)).toEqual([{ party: 'DEM', leading: 1 }])
    expect(houseTally(va)).toHaveLength(2)
    expect(houseTally(va)).toEqual(expect.arrayContaining([{ party: 'DEM', leading: 1 }, { party: 'REP', leading: 1 }]))
    expect(houseFlips(snapshot)).toEqual([{ party: 'DEM', seats: 1 }])
  })

  it('works out money per vote', () => {
    expect(dollarsPerVote(senate.candidates[0])).toBe(100)
    expect(dollarsPerVote(senate.candidates[1])).toBeNull()
  })

  it('leads with one story of each kind', () => {
    const highlights = resultHighlights(snapshot)
    const kinds = highlights.map((h) => h.kind)
    expect(kinds.slice(0, 4)).toEqual(['closest', 'incumbent-behind', 'money-underdog', 'priciest-votes'])
    expect(highlights[0].headline).toBe('VA-2: 20 votes apart')
    expect(highlights[1].detail).toBe('Challenger (D) leads the sitting member by 0.2 points.')
    expect(highlights[2].headline).toBe('Challenger leads despite being outraised 10.0 to 1')
    expect(highlights.find((h) => h.kind === 'turnout-high')?.county).toBe('Big')
    expect(highlights.find((h) => h.kind === 'turnout-low')?.county).toBe('Small')
  })

  it('leaves turnout out while a state is still counting', () => {
    const counting = { ...va, races: [{ ...senate, reporting: { done: 3, total: 10, unit: 'counties' as const } }] }
    expect(countingComplete(counting)).toBe(false)
    const highlights = resultHighlights({ ...snapshot, states: { VA: counting } })
    expect(highlights.some((h) => h.kind.startsWith('turnout'))).toBe(false)
  })
})

describe('results link and snapshot URL', () => {
  it('shows the results link on Election Day and while states count', () => {
    expect(resultsLinkPhase('2026-11-02')).toBeNull()
    expect(resultsLinkPhase('2026-11-03')).toBe('tonight')
    expect(resultsLinkPhase('2026-11-04')).toBe('counting')
    expect(resultsLinkPhase('2026-12-18')).toBe('counting')
    expect(resultsLinkPhase('2026-12-19')).toBeNull()
  })

  it('changes the query each minute for remote snapshots only', () => {
    const at = Date.UTC(2026, 10, 4, 12, 0, 30)
    expect(snapshotRequestUrl('https://example.org/s.json', at)).toBe(`https://example.org/s.json?t=${Math.floor(at / 60_000)}`)
    expect(snapshotRequestUrl('/dev-results.json', at)).toBe('/dev-results.json')
  })
})

describe('priciest votes', () => {
  it('skips races still reporting', () => {
    const race = (done: number) => ({
      office: 'S' as const,
      district: 0,
      label: 'U.S. Senate',
      special: false,
      totalVotes: 20000,
      reporting: { done, total: 10, unit: 'precincts' as const },
      counties: {},
      candidates: [
        { name: 'A Lead', party: 'DEM', votes: 12000, profile: { receipts: 9_000_000 } as never },
        { name: 'B Trail', party: 'REP', votes: 8000 },
      ],
    })
    const snapshot = (done: number) =>
      ({
        election: { date: '2026-11-03', name: 'x' },
        generatedAt: '2026-11-04T00:00:00Z',
        states: { AK: { state: 'AK', name: 'Alaska', source: { name: 's', url: 'u', lastUpdated: null }, registered: null, ballots: null, counties: {}, races: [race(done)] } },
      }) as never
    expect(resultHighlights(snapshot(6)).some((h) => h.kind === 'priciest-votes')).toBe(false)
    expect(resultHighlights(snapshot(10)).some((h) => h.kind === 'priciest-votes')).toBe(true)
  })
})

describe('aggregator states', () => {
  it('labels percent reporting and marks civicAPI states', () => {
    const race = { reporting: { done: 86, total: 100, unit: 'percent' as const } } as never
    expect(reportingLabel(race)).toBe('About 86% reporting')
    expect(reportingLabel({ reporting: { done: 100, total: 100, unit: 'percent' } } as never)).toBe('All reporting')
    expect(isAggregated({ source: { aggregator: true } } as never)).toBe(true)
    expect(isAggregated({ source: {} } as never)).toBe(false)
  })
})

describe('calls and certification', () => {
  const counted = () =>
    race({ candidates: [candidate('Ann Lead', 'DEM', 60), candidate('Bo Trail', 'REP', 40)] })

  it('keeps leading, called and certified apart', () => {
    expect(raceStatus(counted())).toBe('counting')
    expect(raceWinner(counted())).toBeNull()
    const called = { ...counted(), call: { winner: 'Ann Lead', party: 'DEM', source: 'civicAPI', at: '2026-11-04T03:00:00Z' } }
    expect(raceStatus(called)).toBe('called')
    expect(raceWinner(called)?.name).toBe('Ann Lead')
    expect(statusLine(called)).toMatch(/^Called by civicAPI Nov [34]$/)
    const certified = { ...called, certified: '2026-11-21' }
    expect(raceStatus(certified)).toBe('certified')
    expect(statusLine(certified)).toBe('Certified Nov 21')
  })

  it('ignores a call naming nobody on the ballot', () => {
    const odd = { ...counted(), call: { winner: 'Someone Else', party: 'DEM', source: 'civicAPI', at: null } }
    expect(raceStatus(odd)).toBe('counting')
  })
})

describe('the next Congress', () => {
  const seat = (office: 'S' | 'H', district: number, winner: string, extra: Partial<RaceResult> = {}) =>
    race({
      office,
      district,
      candidates: [candidate('W', winner, 60), candidate('L', winner === 'DEM' ? 'REP' : 'DEM', 40)],
      ...extra,
    })
  const call = { winner: 'W', party: 'DEM', source: 'civicAPI', at: null }

  it('adds Senate races to the seats not up', () => {
    const snapshot: ResultsSnapshot = {
      election: { date: '', name: '' },
      generatedAt: '',
      states: {
        AA: state('AA', [seat('S', 0, 'DEM', { call })]),
        BB: state('BB', [seat('S', 0, 'DEM', { certified: '2026-11-20' })]),
        CC: state('CC', [seat('S', 0, 'REP')]),
      },
    }
    const senate = chamberOutlook(snapshot, 'S')
    expect(senate.seats.DEM).toMatchObject({ before: 47, after: 36, holdover: 34, called: 1, certified: 1, leading: 0 })
    expect(senate.seats.REP).toMatchObject({ before: 53, after: 32, leading: 1 })
    expect(senate.uncounted).toBe(32)
    expect(senate.controlBefore).toBe('REP')
    expect(senate.controlAfter).toBeNull()
  })

  it('counts a 50-50 Senate for the vice president’s party', () => {
    expect(chamberControl('S', { DEM: 50, REP: 50, OTH: 0 })).toBe('REP')
    expect(chamberControl('S', { DEM: 51, REP: 49, OTH: 0 })).toBe('DEM')
    expect(chamberControl('S', { DEM: 49, REP: 49, OTH: 2 })).toBeNull()
    expect(chamberControl('H', { DEM: 217, REP: 217, OTH: 1 })).toBeNull()
  })

  it('explains a flipped House and what it means with the Senate', () => {
    const races = Array.from({ length: 435 }, (_, i) => seat('H', i + 1, i < 240 ? 'DEM' : 'REP', i < 200 ? { call } : {}))
    const snapshot: ResultsSnapshot = { election: { date: '', name: '' }, generatedAt: '', states: { AA: state('AA', races) } }
    const house = chamberOutlook(snapshot, 'H')
    expect(house.seats.DEM.after).toBe(240)
    expect(controlHeadline(house)).toBe('Flips to Democrats')
    // 200 called is short of 218: the majority rests on leads.
    expect(house.controlSettled).toBeNull()
    const notes = chamberNotes(house)
    expect(notes[0]).toBe('Democrats would take the House, 240 to 195, up from 215.')
    expect(notes[1]).toBe('Democrats could lose 22 of their own on a simple-majority vote and still win it.')
    expect(notes.some((n) => n.startsWith('Not settled: Democrats have 200 seats called or certified'))).toBe(true)

    const senate = chamberOutlook({ ...snapshot, states: {} }, 'S')
    // Only the 65 seats not up: no majority, so nothing to say about both chambers yet.
    expect(senate.controlAfter).toBeNull()
    expect(congressNotes(senate, house).some((n) => n.startsWith('The new House majority'))).toBe(true)
  })
})
