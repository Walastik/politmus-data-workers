import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { billStub, type Official } from '../types'
import Explorer from './Explorer'

const clerk = vi.hoisted(() => ({ signedIn: true, savedAddress: null as string | null }))

vi.mock('@clerk/clerk-react', () => {
  const UserButton = () => null
  UserButton.UserProfilePage = () => null
  return {
    SignedIn: ({ children }: { children: ReactNode }) => (clerk.signedIn ? <>{children}</> : null),
    SignedOut: ({ children }: { children: ReactNode }) => (clerk.signedIn ? null : <>{children}</>),
    SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
    UserButton,
    useAuth: () => ({ isSignedIn: clerk.signedIn }),
    useUser: () => ({
      user:
        clerk.signedIn && clerk.savedAddress
          ? { unsafeMetadata: { savedAddress: clerk.savedAddress } }
          : null,
      isLoaded: true,
    }),
  }
})

function official(id: string, name: string, extra: Partial<Official> = {}): Official {
  return {
    id,
    name,
    state: 'NY',
    party: 'Democratic',
    office: 'Representative',
    district: 1,
    current_member: true,
    phone: null,
    office_address: null,
    website_url: 'https://example.house.gov',
    ...extra,
  }
}

const roster = [
  official('A1', 'Alice Done', { positions_status: 'ok', positions_count: 12 }),
  official('B2', 'Blocked, Bob', {
    display_name: 'Bob Blocked',
    positions_status: 'blocked',
    positions_count: null,
  }),
  official('C3', 'Cara Pending'),
]

const progress = {
  population: 3,
  attempted: 2,
  by_status: { ok: 1, blocked: 1 },
  not_attempted: 1,
  stances_total: 12,
  last_success_at: null,
  current_versions: [],
  recent: [],
  problems: [],
}

let currentSearch = ''

function SearchSpy() {
  const { search } = useLocation()
  useEffect(() => {
    currentSearch = search
  }, [search])
  return null
}

function renderExplorer(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/dev-explorer${search}`]}>
      <Explorer />
      <SearchSpy />
    </MemoryRouter>,
  )
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('Explorer stated positions', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('/api/positions/progress') ? progress : roster
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
  })

  afterEach(() => {
    clerk.signedIn = true
    vi.restoreAllMocks()
  })

  it('shows the progress panel, card badges and filter when signed in', async () => {
    renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'Roster' }))

    expect(await screen.findByText('Alice Done')).toBeInTheDocument()
    expect(screen.getByText('AI positions (12)')).toBeInTheDocument()
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(await screen.findByText('Stated positions: 1 of 3 processed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Has AI positions' }))
    expect(screen.getByText('Alice Done')).toBeInTheDocument()
    expect(screen.queryByText('Bob Blocked')).not.toBeInTheDocument()
    expect(screen.queryByText('Cara Pending')).not.toBeInTheDocument()
  })

  it('shows the display name on roster cards when the API has one', async () => {
    renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'Roster' }))

    expect(await screen.findByText('Bob Blocked')).toBeInTheDocument()
    expect(screen.queryByText('Blocked, Bob')).not.toBeInTheDocument()
    expect(screen.getByText('Alice Done')).toBeInTheDocument()
  })

  it('shows none of it when signed out', async () => {
    clerk.signedIn = false
    renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'Roster' }))

    expect(await screen.findByText('Alice Done')).toBeInTheDocument()
    expect(screen.queryByText('AI positions (12)')).not.toBeInTheDocument()
    expect(screen.queryByText('Blocked')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Has AI positions' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Stated positions:/)).not.toBeInTheDocument()
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('/api/positions/progress'))).toBe(false)
  })
})

describe('Explorer deep links', () => {
  const bill = { ...billStub('hr1-119'), title: 'A Very Long Bill Title' }

  beforeEach(() => {
    clerk.signedIn = false
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/officials/A1')) {
        return jsonResponse({ ...roster[0], votes: [], stated_positions: [], positions_sync: null })
      }
      if (url.includes('/api/bills/hr1-119')) {
        return jsonResponse(bill)
      }
      if (url.includes('/api/bills/')) {
        return jsonResponse({ detail: 'Not found' }, 404)
      }
      if (url.includes('/api/bills?')) {
        return jsonResponse({ items: [bill], total: 1 })
      }
      return jsonResponse(roster)
    })
  })

  afterEach(() => {
    clerk.signedIn = true
    vi.restoreAllMocks()
  })

  it('restores the official and bill drawers from the URL', async () => {
    renderExplorer('?tab=roster&official=A1&bill=hr1-119')

    const dialogs = await screen.findAllByRole('dialog')
    expect(dialogs).toHaveLength(2)
    expect(await within(dialogs[0]).findByText('Alice Done')).toBeInTheDocument()
    expect(await within(dialogs[1]).findByText('A Very Long Bill Title')).toBeInTheDocument()
  })

  it('opens a bill on its own and drops the param when closed', async () => {
    renderExplorer('?tab=bills&bill=hr1-119')

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('A Very Long Bill Title')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentSearch).toBe('?tab=bills')
  })

  it('pushes the official param on open and steps back on close', async () => {
    renderExplorer('?tab=roster')

    fireEvent.click(await screen.findByRole('button', { name: /Alice Done/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(currentSearch).toBe('?tab=roster&official=A1')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentSearch).toBe('?tab=roster')
  })

  it('shows the drawer error state for an unknown bill', async () => {
    renderExplorer('?tab=bills&bill=nope')

    expect(await screen.findByText('Failed to load bill (404)')).toBeInTheDocument()
  })
})

describe('Explorer My Representatives', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/lookup')) {
        return jsonResponse({ normalized_input: { line1: '1 Main St', state: 'UT' }, representatives: [] })
      }
      return jsonResponse(url.includes('/api/positions/progress') ? progress : roster)
    })
  })

  afterEach(() => {
    clerk.signedIn = true
    clerk.savedAddress = null
    vi.restoreAllMocks()
  })

  it('shows the saved address results from another tab', async () => {
    clerk.savedAddress = '1 Main St, Provo, UT'
    renderExplorer('?tab=roster')

    fireEvent.click(screen.getByRole('button', { name: 'My Representatives' }))
    expect(currentSearch).toBe('?tab=lookup')
    expect(await screen.findByLabelText(/Street address/i)).toHaveValue('1 Main St, Provo, UT')
    expect(await screen.findByRole('tab', { name: /Representatives/i })).toBeInTheDocument()
  })

  it('has no button without a saved address or when signed out', () => {
    const { unmount } = renderExplorer('?tab=roster')
    expect(screen.queryByRole('button', { name: 'My Representatives' })).not.toBeInTheDocument()
    unmount()

    clerk.signedIn = false
    clerk.savedAddress = '1 Main St, Provo, UT'
    renderExplorer('?tab=roster')
    expect(screen.queryByRole('button', { name: 'My Representatives' })).not.toBeInTheDocument()
  })

  it('keeps lookup results when switching tabs', async () => {
    clerk.savedAddress = '1 Main St, Provo, UT'
    renderExplorer('?tab=lookup')
    await screen.findByRole('tab', { name: /Representatives/i })

    fireEvent.click(screen.getByRole('button', { name: 'Roster' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lookup' }))
    const lookups = vi
      .mocked(globalThis.fetch)
      .mock.calls.filter(([input]) => String(input).includes('/api/lookup'))
    expect(lookups).toHaveLength(1)
  })
})

describe('Explorer candidates tab', () => {
  const paxton = {
    ...official('S6TX00388', 'Paxton, Warren Kenneth Jr.', {
      display_name: 'Ken Paxton',
      state: 'Texas',
      party: 'Republican',
      office: 'Senate candidate',
      district: null,
      current_member: false,
      level: 'candidate',
      website_url: 'http://kenpaxton.com/',
    }),
    votes: [],
    stated_positions: [],
    positions_sync: null,
    wikipedia_url: 'https://en.wikipedia.org/wiki/Ken_Paxton',
    bio: {
      description: 'Candidate for US Senate',
      birth_date: '1962-12-23',
      occupations: ['lawyer'],
      education: ['Baylor University'],
      positions_held: ['Texas Attorney General'],
    },
    candidacies: [
      {
        fec_candidate_id: 'S6TX00388',
        election_year: 2026,
        state: 'TX',
        office: 'S',
        district: 0,
        race_label: 'U.S. Senate',
        election_date: '2026-11-03',
        party: 'Republican',
        incumbent_challenge: 'C',
        in_general_election: true,
        receipts: 19_497_809,
        cash_on_hand: 4_925_105,
        coverage_end_date: '2026-09-30',
      },
    ],
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-21T12:00:00') })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/candidates/races')) {
        return jsonResponse({ total_count: 0, items: [], source: 'Federal Election Commission (OpenFEC)' })
      }
      if (url.includes('/finance')) {
        return jsonResponse({ official_id: 'S6TX00388', fec_candidate_ids: [], source: 'FEC', elections: [] })
      }
      return jsonResponse(paxton)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('switches to the candidates tab', async () => {
    renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'Candidates' }))
    expect(await screen.findByText('No races match this filter.')).toBeInTheDocument()
    expect(currentSearch).toBe('?tab=candidates')
  })

  it("shows a candidate's race and background instead of votes", async () => {
    renderExplorer('?tab=candidates&official=S6TX00388')
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByText('Running for U.S. Senate · Texas')).toBeInTheDocument()
    expect(
      within(drawer).getByText('General election Nov 3, 2026 · Challenger · On the November ballot'),
    ).toBeInTheDocument()
    expect(within(drawer).getByText('Texas Attorney General')).toBeInTheDocument()
    expect(within(drawer).getByRole('link', { name: /Wikipedia/ })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Ken_Paxton',
    )
    expect(within(drawer).getByLabelText(/Campaign website, kenpaxton.com/)).toBeInTheDocument()
    expect(within(drawer).getByText('Candidate')).toBeInTheDocument()
    expect(within(drawer).getByText('Texas · Running for U.S. Senate · Statewide')).toBeInTheDocument()
    expect(within(drawer).queryByText('Recorded votes')).not.toBeInTheDocument()
    expect(
      within(drawer).getByRole('button', { name: 'Campaign Finance (preview)' }),
    ).toBeInTheDocument()
  })
})
