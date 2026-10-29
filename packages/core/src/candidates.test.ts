import { describe, expect, it } from 'vitest'

import { candidateTags, hiddenFilersNote, racesPath, racesSourceNote, racesSummary } from './candidates'
import type { Race, RaceCandidate, RacesPage } from './types'

const race = (partial: Partial<Race>) =>
  ({ key: 'r', election_date: '2026-11-03', state_name: 'Texas', candidates: [], hidden_count: 0, ballot_filtered: true, ...partial }) as Race

describe('candidates page', () => {
  it('builds the races request', () => {
    expect(racesPath({ state: 'TX', office: 'S', query: 'allred', showAll: true }, 40)).toBe(
      '/api/candidates/races?limit=40&state=TX&office=S&q=allred&all=true',
    )
    expect(racesPath({}, 20)).toBe('/api/candidates/races?limit=20')
  })

  it('summarizes the races and their source', () => {
    const page = { total_count: 2, source: 'OpenFEC', items: [race({}), race({ ballot_source: 'Texas SOS' })] } as RacesPage
    expect(racesSummary(page, false)).toBe('2 races · General election Nov 3, 2026 · Most expensive first')
    expect(racesSourceNote(page)).toBe(
      'Source: OpenFEC. Races list the campaigns that filed a pre-general report, the ones on the November ballot. Texas races list the November nominees (Texas SOS).',
    )
  })

  it('explains hidden filers', () => {
    expect(hiddenFilersNote(race({}))).toBeNull()
    expect(hiddenFilersNote(race({ hidden_count: 1, ballot_filtered: false }))).toBe('1 more filer not shown: raised under $5,000.')
  })

  it('tags incumbents, sitting members and ballot status', () => {
    const c = (partial: Partial<RaceCandidate>) => ({ incumbent_challenge: 'C', current_member: false, in_general_election: false, ...partial }) as RaceCandidate
    expect(candidateTags(c({ incumbent_challenge: 'I', in_general_election: true }), true).map((t) => t.label)).toEqual(['Incumbent', 'On Nov. ballot'])
    expect(candidateTags(c({ current_member: true, in_general_election: true }), false).map((t) => t.label)).toEqual(['In Congress'])
  })
})
