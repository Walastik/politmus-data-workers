import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { billStub, type Official } from '../types'
import { clerkState, currentUrl, jsonResponse, renderApp, resetClerkState } from '../testUtils'

vi.mock('@clerk/clerk-react', async () => (await import('../clerkMock')).clerkMock())

function official(id: string, name: string, extra: Partial<Official> = {}): Official {
  return {
    id,
    name,
    state: 'New York',
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
  official('C3', 'Cara Pending', { district: 2 }),
  official('S1', 'Sam Senator', { office: 'Senator', district: null, party: 'Republican', state: 'Ohio' }),
  official('S2', 'Sue Senator', {
    office: 'Senator',
    district: null,
    state: 'Ohio',
    score_points: 3,
    score_pct: 80,
    score_matches: 6,
  }),
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

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input)
    return jsonResponse(url.includes('/api/positions/progress') ? progress : roster)
  })
}

afterEach(() => {
  resetClerkState()
  vi.restoreAllMocks()
})

describe('Congress chamber views', () => {
  beforeEach(mockApi)

  it('shows each chamber’s party makeup', async () => {
    renderApp('/congress')

    const senate = await screen.findByRole('region', { name: 'Senate makeup' })
    expect(within(senate).getByText('2 members')).toBeInTheDocument()
    expect(within(senate).getByText(/1 of 2 have a Politmus Score/)).toBeInTheDocument()
    const house = screen.getByRole('region', { name: 'House makeup' })
    expect(within(house).getByText(/3 members/)).toBeInTheDocument()
  })

  it('groups senators by state with their score', async () => {
    renderApp('/congress')

    const ohio = (await screen.findByRole('heading', { name: 'Ohio' })).closest('li')!
    expect(within(ohio).getByText('Sam Senator')).toBeInTheDocument()
    expect(within(ohio).getByText('Sue Senator')).toBeInTheDocument()
    expect(within(ohio).getByText('80%')).toBeInTheDocument()
    expect(screen.queryByText('Alice Done')).not.toBeInTheDocument()
  })

  it('lists House delegations by state, collapsed until opened', async () => {
    renderApp('/congress?view=house')

    const state = await screen.findByRole('button', { name: /New York/ })
    expect(state).toHaveAttribute('aria-expanded', 'false')
    expect(within(state).getByText(/3 seats · 3D/)).toBeInTheDocument()
    expect(screen.queryByText('Alice Done')).not.toBeInTheDocument()

    fireEvent.click(state)
    expect(screen.getByText('Alice Done')).toBeInTheDocument()
    expect(screen.getByText('D · District 2')).toBeInTheDocument()
  })

  it('filters by name and opens matching states', async () => {
    renderApp('/congress?view=house')
    await screen.findByRole('button', { name: /New York/ })

    fireEvent.change(screen.getByLabelText('Search members by name'), { target: { value: 'cara' } })
    expect(await screen.findByText('Cara Pending')).toBeInTheDocument()
    expect(screen.queryByText('Alice Done')).not.toBeInTheDocument()
  })

  it('keeps the view in the URL', async () => {
    renderApp('/congress')
    fireEvent.click(await screen.findByRole('tab', { name: 'House' }))
    expect(currentUrl.search).toBe('?view=house')
  })
})

describe('Congress member list', () => {
  beforeEach(mockApi)

  it('shows the progress panel, card badges and filter when signed in', async () => {
    renderApp('/congress?view=list')

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
    renderApp('/congress?view=list')

    expect(await screen.findByText('Bob Blocked')).toBeInTheDocument()
    expect(screen.queryByText('Blocked, Bob')).not.toBeInTheDocument()
  })

  it('shows scores and positions to signed-out visitors, without the progress panel', async () => {
    clerkState.signedIn = false
    renderApp('/congress?view=list')

    expect(await screen.findByText('Alice Done')).toBeInTheDocument()
    expect(screen.getByText('AI positions (12)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Has AI positions' })).toBeInTheDocument()
    expect(screen.queryByText(/Stated positions:/)).not.toBeInTheDocument()
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input))
    expect(urls.some((url) => url.includes('/api/positions/progress'))).toBe(false)
  })

  it('sorts by score', async () => {
    renderApp('/congress?view=list')
    await screen.findByText('Alice Done')

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'score' } })
    const names = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(names[0]).toBe('Sue Senator')
  })
})

describe('Member and bill drawers', () => {
  const bill = { ...billStub('hr1-119'), title: 'A Very Long Bill Title' }

  beforeEach(() => {
    clerkState.signedIn = false
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

  it('restores the official and bill drawers from the URL', async () => {
    renderApp('/congress?view=list&official=A1&bill=hr1-119')

    const dialogs = await screen.findAllByRole('dialog')
    expect(dialogs).toHaveLength(2)
    expect(await within(dialogs[0]).findByText('Alice Done')).toBeInTheDocument()
    expect(await within(dialogs[1]).findByText('A Very Long Bill Title')).toBeInTheDocument()
  })

  it('opens a bill on its own and drops the param when closed', async () => {
    renderApp('/bills?bill=hr1-119')

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('A Very Long Bill Title')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentUrl.search).toBe('')
  })

  it('pushes the official param on open, keeping the view, and steps back on close', async () => {
    renderApp('/congress?view=list')

    fireEvent.click(await screen.findByRole('button', { name: /Alice Done/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(currentUrl.search).toBe('?view=list&official=A1')

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(currentUrl.search).toBe('?view=list')
  })

  it('shows the drawer error state for an unknown bill', async () => {
    renderApp('/bills?bill=nope')

    expect(await screen.findByText('Failed to load bill (404)')).toBeInTheDocument()
  })
})
