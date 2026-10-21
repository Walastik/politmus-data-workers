import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinanceElection, OfficialFinance } from '../types'
import CampaignFinanceSection from './CampaignFinanceSection'

function election(year: number, overrides: Partial<FinanceElection> = {}): FinanceElection {
  return {
    fec_candidate_id: 'S6MN00267',
    election_year: year,
    coverage_start_date: `${year - 5}-01-01`,
    coverage_end_date: `${year}-12-31`,
    receipts: 21873758.67,
    small_donor_share: 0.4549,
    home_state: 'MN',
    in_state_share: 0.2732,
    top_states: [
      { state: 'MN', total: 3633618.89 },
      { state: 'CA', total: 2045408.63 },
    ],
    funding_mix: [
      { key: 'small_donors', label: 'Small donors ($200 or less)', amount: 6582686.5, share: 0.3009 },
      { key: 'pacs', label: 'PACs', amount: 1368278, share: 0.0626 },
      { key: 'party', label: 'Party committees', amount: 0, share: 0 },
    ],
    outside_spending: {
      support_total: 107573.86,
      oppose_total: 0,
      support_count: 9,
      oppose_count: 0,
      top_support: [{ committee_id: 'C1', name: 'Planned Parenthood MN', total: 54975.2 }],
      top_oppose: [],
    },
    fec_url: 'https://www.fec.gov/data/candidate/S6MN00267/',
    ...overrides,
  }
}

const finance: OfficialFinance = {
  official_id: 'K000367',
  fec_candidate_ids: ['S6MN00267'],
  opensecrets_id: 'N00027500',
  opensecrets_url: 'https://www.opensecrets.org/members-of-congress/summary?cid=N00027500',
  source: 'Federal Election Commission (OpenFEC)',
  elections: [
    election(2030, {
      receipts: 2519524.84,
      outside_spending: {
        support_total: 0,
        oppose_total: 0,
        support_count: 0,
        oppose_count: 0,
        top_support: [],
        top_oppose: [],
      },
    }),
    election(2024),
  ],
  peer_comparison: {
    election_year: 2024,
    fec_candidate_id: 'S6MN00267',
    chamber: 'senate',
    chamber_label: 'senators',
    party: 'Democratic',
    metrics: [
      {
        key: 'receipts',
        label: 'Raised',
        value: 21873758.67,
        chamber_percentile: 0.4,
        chamber_count: 10,
        party_percentile: 0.4,
        party_count: 5,
      },
    ],
  },
}

async function openSection() {
  render(<CampaignFinanceSection officialId="K000367" />)
  fireEvent.click(screen.getByRole('button', { name: 'Campaign Finance (preview)' }))
  await screen.findByRole('group', { name: 'Election' })
}

describe('CampaignFinanceSection', () => {
  beforeEach(() => {
    // The PAC section loads its own summary; this member has none yet.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes('/finance/pacs')
              ? { synced: false, gift_count: 0, categories: [], top_pacs: [] }
              : finance,
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens on the compared election with peer lines', async () => {
    await openSection()
    expect(screen.getByRole('button', { name: '2024' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('More than 40% of senators')).toBeInTheDocument()
    expect(screen.getByText('More than 40% of Democratic senators')).toBeInTheDocument()
    expect(screen.getByText('From MN')).toBeInTheDocument()
  })

  it('shows the funding mix without empty slices', async () => {
    await openSection()
    expect(screen.getByText('Small donors ($200 or less)')).toBeInTheDocument()
    expect(screen.queryByText('Party committees')).not.toBeInTheDocument()
  })

  it('explains outside spending on request', async () => {
    await openSection()
    expect(screen.getByText('Planned Parenthood MN')).toBeInTheDocument()
    expect(screen.queryByText(/independent expenditures/)).not.toBeInTheDocument()
    const toggles = screen.getAllByRole('button', { name: 'What does this mean?' })
    fireEvent.click(toggles[toggles.length - 1])
    expect(screen.getByText(/independent expenditures/)).toBeInTheDocument()
  })

  it('switches elections and drops the comparison for a race in progress', async () => {
    await openSection()
    fireEvent.click(screen.getByRole('button', { name: '2030' }))
    expect(screen.queryByText('More than 40% of senators')).not.toBeInTheDocument()
    expect(
      screen.getByText('No outside spending was reported for or against this candidate in this election.'),
    ).toBeInTheDocument()
  })

  it('lists out-of-state sources without the home state', async () => {
    await openSection()
    expect(screen.getByText(/Biggest out-of-state sources: CA/)).toBeInTheDocument()
  })
})

describe('CampaignFinanceSection race comparison', () => {
  const candidate = (id: string, name: string, party: string, receipts: number) => ({
    official_id: id,
    fec_candidate_id: id,
    name,
    party,
    photo_url: null,
    website_url: null,
    incumbent_challenge: 'C',
    is_member: false,
    current_member: false,
    in_general_election: true,
    receipts,
    disbursements: null,
    cash_on_hand: 1_000_000,
    coverage_end_date: '2026-09-30',
    positions_count: null,
    small_donor_share: 0.54,
    outside_support: 4_276_701,
    outside_oppose: 1_281_079,
  })

  const candidateFinance: OfficialFinance = {
    official_id: 'S6TX00388',
    fec_candidate_ids: ['S6TX00388'],
    source: 'Federal Election Commission (OpenFEC)',
    elections: [election(2026, { fec_candidate_id: 'S6TX00388', home_state: 'TX' })],
    peer_comparison: null,
    race_comparison: {
      key: '2026-TX-S',
      election_year: 2026,
      election_date: '2026-11-03',
      state: 'TX',
      state_name: 'Texas',
      office: 'S',
      district: 0,
      label: 'U.S. Senate',
      total_receipts: 148_270_645,
      ballot_filtered: true,
      hidden_count: 4,
      candidates: [
        candidate('S6TX00479', 'James Talarico', 'Democratic', 128_772_835),
        candidate('S6TX00388', 'Ken Paxton', 'Republican', 19_497_809),
      ],
    },
  }

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes('/finance/pacs')
              ? { synced: false, gift_count: 0, categories: [], top_pacs: [] }
              : candidateFinance,
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the race side by side and marks the candidate', async () => {
    render(<CampaignFinanceSection officialId="S6TX00388" />)
    fireEvent.click(screen.getByRole('button', { name: 'Campaign Finance (preview)' }))

    expect(await screen.findByText('The race · Texas · U.S. Senate')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem').filter((row) => row.textContent?.includes('Cash'))
    expect(rows.map((row) => row.textContent?.split('(')[0])).toEqual(['James Talarico', 'Ken Paxton'])
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[0]).toHaveTextContent('Small donors 54%')
    expect(rows[0]).toHaveTextContent('Outside +$4.3M / −$1.3M')
    // Members' peer comparison text doesn't apply to a candidate's race.
    expect(screen.queryByText(/Comparisons with other members/)).not.toBeInTheDocument()
  })
})
