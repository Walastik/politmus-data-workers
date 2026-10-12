import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import AddressLookup from './AddressLookup'

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: null, isLoaded: true }),
}))

describe('AddressLookup Integration & Race Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders representatives successfully even when voter-info lookup fails (decoupled failure)', async () => {
    const mockLookupResponse = {
      normalized_input: {
        line1: '123 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
      },
      representatives: [
        {
          name: 'Jane Doe',
          office: 'Representative',
          officeName: 'U.S. Representative',
          divisionId: 'ocd-division/country:us/state:tx/cd:37',
          divisionName: 'Texas 37th Congressional District',
          levels: ['country'],
          roles: ['legislatorLowerBody'],
          party: 'Independent',
          phones: ['(202) 225-0000'],
          urls: ['https://janedoe.house.gov'],
          emails: [],
          channels: [],
        },
      ],
    }

    // Mock fetch: /api/lookup succeeds, /api/voter-info fails with 502
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/lookup')) {
        return Promise.resolve(
          new Response(JSON.stringify(mockLookupResponse), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/api/voter-info')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              uiState: 'unavailable',
              upstreamStatus: 'upstream_forbidden',
              detail: 'API key not configured',
            }),
            {
              status: 502,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      }
      return Promise.reject(new Error('Unknown url'))
    })

    render(<AddressLookup />)

    const input = screen.getByLabelText(/Street address/i)
    fireEvent.change(input, { target: { value: '123 Main St, Austin, TX 78701' } })

    const submitBtn = screen.getByRole('button', { name: /Find representatives/i })
    fireEvent.click(submitBtn)

    // Representative roster MUST render despite voter-info failure
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
      expect(screen.getByText('Representative')).toBeInTheDocument()
    })

    // Both tabs must be available
    const repTab = screen.getByRole('tab', { name: /Representatives/i })
    const votingTab = screen.getByRole('tab', { name: /Voting Locations/i })
    expect(repTab).toBeInTheDocument()
    expect(votingTab).toBeInTheDocument()

    // Switch to voting locations tab - should show unavailable state gracefully without crash
    fireEvent.click(votingTab)
    await waitFor(() => {
      expect(
        screen.getByText(/Live voting location lookup is currently unavailable/i),
      ).toBeInTheDocument()
    })
  })

  it('aborts prior voter-info request when new address is submitted (race condition prevention)', async () => {
    const abortSignals: AbortSignal[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/lookup')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                normalized_input: { line1: 'Test St', state: 'TX' },
                representatives: [],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        if (url.includes('/api/voter-info')) {
          if (init?.signal) {
            abortSignals.push(init.signal)
          }
          // Never resolve to simulate slow network
          return new Promise(() => {})
        }
        return Promise.reject(new Error('Unknown url'))
      },
    )

    render(<AddressLookup />)

    const input = screen.getByLabelText(/Street address/i)
    const submitBtn = screen.getByRole('button', { name: /Find representatives/i })

    // First search
    fireEvent.change(input, { target: { value: 'First Address, Austin, TX' } })
    fireEvent.click(submitBtn)

    expect(abortSignals.length).toBe(1)
    expect(abortSignals[0].aborted).toBe(false)

    // Wait for the lookup request to finish so button is enabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Find representatives/i })).not.toBeDisabled()
    })

    // Second search
    fireEvent.change(input, { target: { value: 'Second Address, Dallas, TX' } })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))

    expect(abortSignals.length).toBe(2)
    // First signal MUST now be aborted!
    expect(abortSignals[0].aborted).toBe(true)
    expect(abortSignals[1].aborted).toBe(false)
  })
})
