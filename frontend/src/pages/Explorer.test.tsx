import { fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { billStub, type Official } from '../types'
import Explorer from './Explorer'

const clerk = vi.hoisted(() => ({ signedIn: true }))

vi.mock('@clerk/clerk-react', () => {
  const UserButton = () => null
  UserButton.UserProfilePage = () => null
  return {
    SignedIn: ({ children }: { children: ReactNode }) => (clerk.signedIn ? <>{children}</> : null),
    SignedOut: ({ children }: { children: ReactNode }) => (clerk.signedIn ? null : <>{children}</>),
    SignInButton: ({ children }: { children: ReactNode }) => <>{children}</>,
    UserButton,
    useAuth: () => ({ isSignedIn: clerk.signedIn }),
    useUser: () => ({ user: null, isLoaded: true }),
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
  official('B2', 'Bob Blocked', { positions_status: 'blocked', positions_count: null }),
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
