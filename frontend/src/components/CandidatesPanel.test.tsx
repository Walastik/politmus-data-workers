import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Official, Race, RaceCandidate, RacesPage } from '../types'
import CandidatesPanel from './CandidatesPanel'

function candidate(id: string, name: string, extra: Partial<RaceCandidate> = {}): RaceCandidate {
  return {
    official_id: id,
    fec_candidate_id: id,
    name,
    party: 'Democratic',
    photo_url: null,
    website_url: null,
    incumbent_challenge: 'C',
    is_member: false,
    current_member: false,
    in_general_election: false,
    receipts: 1_000_000,
    disbursements: null,
    cash_on_hand: 250_000,
    coverage_end_date: '2026-09-30',
    positions_count: null,
    small_donor_share: null,
    outside_support: null,
    outside_oppose: null,
    ...extra,
  }
}

const senate: Race = {
  key: '2026-TX-S',
  election_year: 2026,
  election_date: '2026-11-03',
  state: 'TX',
  state_name: 'Texas',
  office: 'S',
  district: 0,
  label: 'U.S. Senate',
  total_receipts: 162_535_893,
  ballot_filtered: false,
  hidden_count: 3,
  candidates: [
    candidate('S6TX00479', 'James Talarico', { receipts: 128_772_835 }),
    candidate('S6TX00388', 'Ken Paxton', { party: 'Republican', receipts: 19_497_809 }),
    candidate('C001056', 'John Cornyn', {
      fec_candidate_id: 'S2TX00106',
      party: 'Republican',
      incumbent_challenge: 'I',
      is_member: true,
      current_member: true,
      receipts: 14_265_248,
    }),
    candidate('S4TX00888', 'Theodore E. Brown Jr.', {
      party: 'Libertarian',
      in_general_election: true,
      receipts: 14_257,
    }),
  ],
}

const page: RacesPage = {
  total_count: 1,
  items: [senate],
  source: 'Federal Election Commission (OpenFEC)',
}

describe('CandidatesPanel', () => {
  let urls: string[]

  beforeEach(() => {
    urls = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      urls.push(String(input))
      return new Response(JSON.stringify(page), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('groups candidates by race with incumbency and ballot tags', async () => {
    render(<CandidatesPanel onSelectOfficial={() => {}} />)

    const race = await screen.findByRole('region', { name: 'Texas · U.S. Senate' })
    const names = within(race)
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
    expect(names[0]).toContain('James Talarico')
    expect(names[1]).toContain('Ken Paxton')
    expect(within(race).getByText('Incumbent')).toBeInTheDocument()
    expect(within(race).getByText('On Nov. ballot')).toBeInTheDocument()
    expect(within(race).getByText(/3 more filers not shown/)).toBeInTheDocument()
    expect(screen.getByText(/General election Nov 3, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/including candidates who lost a primary/)).toBeInTheDocument()
  })

  it('sends the filters to the races endpoint', async () => {
    render(<CandidatesPanel onSelectOfficial={() => {}} />)
    await screen.findByRole('region', { name: 'Texas · U.S. Senate' })

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter candidates by state' }), {
      target: { value: 'TX' },
    })
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Filter by office' })).getByRole('button', {
        name: 'Senate',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show all filers' }))

    await waitFor(() => {
      const query = new URL(urls[urls.length - 1], 'http://localhost').searchParams
      expect(query.get('state')).toBe('TX')
      expect(query.get('office')).toBe('S')
      expect(query.get('all')).toBe('true')
    })
  })

  it('opens challengers and members with a header-ready official', async () => {
    const opened: Official[] = []
    render(<CandidatesPanel onSelectOfficial={(official) => opened.push(official)} />)

    fireEvent.click(await screen.findByRole('button', { name: /Ken Paxton/ }))
    fireEvent.click(screen.getByRole('button', { name: /John Cornyn/ }))

    expect(opened.map((official) => [official.id, official.level, official.office])).toEqual([
      ['S6TX00388', 'candidate', 'Senate candidate'],
      ['C001056', 'federal', null],
    ])
    expect(opened[0].state).toBe('Texas')
  })
})
