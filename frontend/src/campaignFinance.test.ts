import { describe, expect, it } from 'vitest'

import {
  defaultElection,
  formatShare,
  partyAdjective,
  peerLines,
  peerPhrase,
} from './campaignFinance'
import type { FinanceElection, OfficialFinance, PeerComparison } from './types'

function election(year: number, overrides: Partial<FinanceElection> = {}): FinanceElection {
  return {
    fec_candidate_id: 'S6MN00267',
    election_year: year,
    receipts: 1000,
    fec_url: 'https://www.fec.gov/data/candidate/S6MN00267/',
    ...overrides,
  }
}

const comparison: PeerComparison = {
  election_year: 2024,
  fec_candidate_id: 'S6MN00267',
  chamber: 'senate',
  chamber_label: 'senators',
  party: 'Democratic',
  metrics: [
    {
      key: 'receipts',
      label: 'Raised',
      value: 1000,
      chamber_percentile: 0.82,
      chamber_count: 97,
      party_percentile: 0.5,
      party_count: 46,
    },
  ],
}

describe('peerPhrase', () => {
  it('phrases percentiles against the group', () => {
    expect(peerPhrase(0.82, 97, 'senators')).toBe('More than 82% of senators')
    expect(peerPhrase(1, 97, 'senators')).toBe('Highest of 98 senators')
    expect(peerPhrase(0, 97, 'senators')).toBe('Lowest of 98 senators')
  })

  it('skips missing comparisons', () => {
    expect(peerPhrase(null, 97, 'senators')).toBeNull()
    expect(peerPhrase(0.5, 0, 'senators')).toBeNull()
  })
})

describe('peerLines', () => {
  it('gives chamber and party lines', () => {
    expect(peerLines(comparison.metrics[0], comparison)).toEqual([
      'More than 82% of senators',
      'More than 50% of Democratic senators',
    ])
  })

  it('maps party names to adjectives', () => {
    expect(partyAdjective('Independent')).toBe('independent')
    expect(partyAdjective('Republican')).toBe('Republican')
    expect(partyAdjective(null)).toBeNull()
  })
})

describe('formatShare', () => {
  it('rounds and flags tiny shares', () => {
    expect(formatShare(0.2732)).toBe('27%')
    expect(formatShare(0.004)).toBe('<1%')
    expect(formatShare(0)).toBe('0%')
    expect(formatShare(null)).toBe('—')
  })
})

describe('defaultElection', () => {
  const finance: OfficialFinance = {
    official_id: 'K000367',
    fec_candidate_ids: ['S6MN00267'],
    source: 'FEC',
    elections: [election(2030), election(2024), election(2018)],
    peer_comparison: comparison,
  }

  it('picks the compared election', () => {
    expect(defaultElection(finance)?.election_year).toBe(2024)
  })

  it('falls back to the newest election with money', () => {
    expect(
      defaultElection({
        ...finance,
        peer_comparison: null,
        elections: [election(2030, { receipts: 0 }), election(2024)],
      })?.election_year,
    ).toBe(2024)
  })
})
