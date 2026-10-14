import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Official } from '../types'
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
    render(<Explorer />)
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
    render(<Explorer />)
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
