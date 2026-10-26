import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CivicLookup, Race, RaceCandidate, VoterInfo, VoterLocation } from '../types'
import HappeningNow from './HappeningNow'

const clerk = vi.hoisted(() => ({ savedAddress: null as string | null }))

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({
    user: clerk.savedAddress ? { unsafeMetadata: { savedAddress: clerk.savedAddress } } : null,
    isLoaded: true,
  }),
}))

const lookup: CivicLookup = {
  normalized_input: { line1: '1100 CONGRESS AVE', line2: null, line3: null, city: 'AUSTIN', state: 'TX', zip: '78701' },
  point: { lat: 30.2764, lon: -97.7398 },
  divisions: [
    { ocd_id: 'ocd-division/country:us/state:tx', name: 'Texas' },
    { ocd_id: 'ocd-division/country:us/state:tx/cd:10', name: 'Congressional District 10' },
  ],
  representatives: [],
}

function site(name: string, latitude: number, longitude: number): VoterLocation {
  return {
    locationName: name,
    line1: '1 Main St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    pollingHours: 'Sun, Oct 25: 12 pm - 6 pm\nMon, Oct 26: 7 am - 7 pm',
    startDate: null,
    endDate: null,
    notes: null,
    latitude,
    longitude,
    sources: [],
  }
}

const voterInfo: VoterInfo = {
  uiState: 'live',
  upstreamStatus: 'ok',
  election: { id: '12000', name: '2026 General Midterm Election', date: '2026-11-03' },
  mailOnly: false,
  pollingLocations: [],
  earlyVoteSites: [
    site('Far Library', 30.5, -97.9),
    site('Capitol Annex', 30.2766, -97.7401),
    site('Rec Center', 30.2781, -97.749),
    site('UT Union', 30.2866, -97.7411),
  ],
  dropOffLocations: [],
  adminBodies: { state: null, local: null },
  otherElections: [],
  fetchedAt: '2026-10-25T12:00:00Z',
}

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

function race(office: 'S' | 'H', district: number, candidates: RaceCandidate[]): Race {
  return {
    key: `2026-TX-${office}-${district}`,
    election_year: 2026,
    election_date: '2026-11-03',
    state: 'TX',
    state_name: 'Texas',
    office,
    district,
    label: office === 'S' ? 'U.S. Senate' : `U.S. House · District ${district}`,
    total_receipts: 0,
    ballot_filtered: false,
    hidden_count: 0,
    candidates,
  }
}

let races: Race[] = []
const baseRaces = () => [
  race('S', 0, [candidate('S1', 'Senate Hopeful')]),
  race('H', 7, [candidate('H7', 'Other District')]),
  race('H', 10, [
    candidate('H10A', 'Sarah Eckhardt'),
    candidate('H10B', 'Sarah Eckhardt'),
    candidate('H10C', 'Chris Gober', { party: 'Republican' }),
  ]),
]

const fetchMock = vi.fn()

function respond(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

beforeEach(() => {
  races = baseRaces()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 25, 12))
  clerk.savedAddress = '1100 Congress Ave, Austin, TX 78701'
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith('/api/lookup')) return respond(lookup)
    if (url.startsWith('/api/voter-info')) return respond(voterInfo)
    if (url.startsWith('/api/candidates/races')) return respond({ total_count: races.length, items: races })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function renderNow() {
  const onSeeAllLocations = vi.fn()
  const onSelectOfficial = vi.fn()
  render(
    <HappeningNow
      onSelectOfficial={onSelectOfficial}
      onSeeAllLocations={onSeeAllLocations}
      onSeeCandidates={vi.fn()}
    />,
  )
  return { onSeeAllLocations, onSelectOfficial }
}

describe('HappeningNow', () => {
  it('says early voting is open and lists the three closest sites', async () => {
    const { onSeeAllLocations } = renderNow()

    expect(await screen.findByRole('heading', { name: 'Early voting is open in Texas' })).toBeInTheDocument()
    expect(screen.getByText('9 days away')).toBeInTheDocument()

    const sites = await screen.findByRole('heading', { name: /Closest early voting sites/i })
    const section = sites.closest('section')!
    const names = within(section)
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)
    expect(names).toEqual(['Capitol Annex', 'Rec Center', 'UT Union'])
    expect(within(section).getAllByText('Sun, Oct 25: 12 pm - 6 pm')).toHaveLength(3)

    fireEvent.click(within(section).getByRole('button', { name: /See all 4 locations/i }))
    expect(onSeeAllLocations).toHaveBeenCalledWith('1100 Congress Ave, Austin, TX 78701')
  })

  it('shows the Senate race and only the voter’s House district, once per candidate', async () => {
    const { onSelectOfficial } = renderNow()

    expect(await screen.findByText('U.S. House · District 10')).toBeInTheDocument()
    expect(screen.getByText('U.S. Senate')).toBeInTheDocument()
    expect(screen.queryByText('Other District')).not.toBeInTheDocument()
    expect(screen.getAllByText('Sarah Eckhardt')).toHaveLength(1)
    expect(screen.getByText(/hasn’t confirmed who is on the November ballot/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Full profile: Chris Gober' }))
    expect(onSelectOfficial).toHaveBeenCalledWith(expect.objectContaining({ id: 'H10C' }))
  })

  it('shows who each candidate is, what they run on, and where to read more', async () => {
    races[0] = race('S', 0, [
      candidate('S1', 'Ken Paxton', {
        party: 'Republican',
        website_url: 'https://www.kenpaxton.com',
        wikipedia_url: 'https://en.wikipedia.org/wiki/Ken_Paxton',
        background: ['Texas Attorney General', 'politician', 'lawyer'],
        top_issues: [
          { label: 'Border security', summary: 'Finish the border wall.', source_url: null },
          { label: 'Energy', summary: null, source_url: null },
        ],
      }),
      candidate('S2', 'Ted Brown', { party: 'Libertarian', website_url: 'https://tedbrown.org/' }),
    ])
    renderNow()

    const paxton = (await screen.findByRole('heading', { name: 'Ken Paxton' })).closest('article')!
    expect(within(paxton).getByText('Texas Attorney General · Lawyer')).toBeInTheDocument()
    expect(within(paxton).getByText('Border security')).toBeInTheDocument()
    expect(within(paxton).getByText('Finish the border wall.')).toBeInTheDocument()
    expect(within(paxton).getByText('AI summary of their campaign site')).toBeInTheDocument()
    expect(within(paxton).getByRole('link', { name: /Campaign site/ })).toHaveAttribute('href', 'https://www.kenpaxton.com')
    expect(within(paxton).getByRole('link', { name: /Wikipedia/ })).toBeInTheDocument()

    const brown = screen.getByRole('heading', { name: 'Ted Brown' }).closest('article')!
    expect(within(brown).getByText('Candidate platform data has not been processed.')).toBeInTheDocument()
    expect(within(brown).getByRole('link', { name: /Campaign site/ })).toHaveAttribute('href', 'https://tedbrown.org/')
  })

  it('shows a confirmed ballot without the warning, including nominees with no FEC filings', async () => {
    races[0] = {
      ...race('S', 0, [candidate('S1', 'Senate Nominee', { in_general_election: true })]),
      ballot_filtered: true,
      ballot_source: 'Test source',
      ballot_complete: true,
      unlisted_nominees: [{ name: 'Ted Brown', party: 'Libertarian' }],
    }
    renderNow()

    expect(await screen.findByText('Ted Brown')).toBeInTheDocument()
    expect(screen.getByText('No FEC filings, so no profile yet.')).toBeInTheDocument()
    expect(screen.getByText(/nominees per Test source/)).toBeInTheDocument()
    // District 10 below is still unconfirmed, so the warning stays for it.
    expect(screen.getByText(/hasn’t confirmed who is on the November ballot/)).toBeInTheDocument()
    // Only District 10's list may be incomplete.
    expect(screen.getAllByRole('button', { name: 'May be incomplete' })).toHaveLength(1)
  })

  it('explains why a race’s list may be incomplete when asked', async () => {
    races[0] = {
      ...race('S', 0, [candidate('S1', 'Senate Nominee', { in_general_election: true })]),
      ballot_filtered: true,
      ballot_source: 'Test source',
      ballot_complete: false,
    }
    races[2] = { ...races[2], ballot_filtered: true, ballot_source: 'Test source', ballot_complete: true }
    renderNow()

    const toggle = await screen.findByRole('button', { name: 'May be incomplete' })
    expect(screen.queryByText(/may not include everyone on your ballot/)).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/independent and third-party candidates/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'May be incomplete' })).toHaveLength(1)
  })

  it('asks for an address when none is saved', async () => {
    clerk.savedAddress = null
    renderNow()

    expect(screen.getByRole('heading', { name: /Early voting is open in \d+ states/ })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Your street address'), {
      target: { value: '1100 Congress Ave, Austin, TX 78701' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show my election' }))

    expect(await screen.findByRole('heading', { name: 'Early voting is open in Texas' })).toBeInTheDocument()
  })
})
