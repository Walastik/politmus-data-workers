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

  it('does not call voter-info until the Voting Locations tab is opened', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/lookup')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ normalized_input: { line1: 'Test St', state: 'TX' }, representatives: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      if (url.includes('/api/voter-info')) {
        return Promise.resolve(
          new Response(JSON.stringify({ uiState: 'unavailable', upstreamStatus: 'x', detail: 'x' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      return Promise.reject(new Error('Unknown url'))
    })
    const voterInfoCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/voter-info'))

    render(<AddressLookup />)
    fireEvent.change(screen.getByLabelText(/Street address/i), { target: { value: '1 Test St, Austin, TX' } })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))

    const votingTab = await screen.findByRole('tab', { name: /Voting Locations/i })
    expect(voterInfoCalls()).toHaveLength(0)

    fireEvent.click(votingTab)
    expect(voterInfoCalls()).toHaveLength(1)

    // Switching away and back for the same address does not refetch
    fireEvent.click(screen.getByRole('tab', { name: /Representatives/i }))
    fireEvent.click(screen.getByRole('tab', { name: /Voting Locations/i }))
    expect(voterInfoCalls()).toHaveLength(1)
  })

  it('still offers the Voting Locations tab when the representative lookup fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/lookup')) {
        return Promise.resolve(
          new Response(JSON.stringify({ detail: 'Census geocoder unavailable' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.includes('/api/voter-info')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              uiState: 'no_election',
              upstreamStatus: 'electionUnknown',
              election: null,
              mailOnly: false,
              pollingLocations: [],
              earlyVoteSites: [],
              dropOffLocations: [],
              adminBodies: { state: null, local: null },
              otherElections: [],
              fetchedAt: '2026-01-01T00:00:00Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.reject(new Error('Unknown url'))
    })

    render(<AddressLookup />)
    fireEvent.change(screen.getByLabelText(/Street address/i), { target: { value: '1 Test St, Austin, TX' } })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))

    expect(await screen.findByText('Census geocoder unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Voting Locations/i }))
    await waitFor(() => {
      expect(screen.queryByText('Census geocoder unavailable')).not.toBeInTheDocument()
      expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-voting')
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

    // First search, then open the voting tab to start a (slow) voter-info request
    fireEvent.change(input, { target: { value: 'First Address, Austin, TX' } })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /Voting Locations/i }))

    expect(abortSignals.length).toBe(1)
    expect(abortSignals[0].aborted).toBe(false)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Find representatives/i })).not.toBeDisabled()
    })

    // Second search while the voting tab is open: the in-flight request is aborted
    // immediately, and a new one starts once the representative lookup settles
    fireEvent.change(input, { target: { value: 'Second Address, Dallas, TX' } })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))

    expect(abortSignals[0].aborted).toBe(true)
    await waitFor(() => expect(abortSignals.length).toBe(2))
    expect(abortSignals[1].aborted).toBe(false)
  })

  it('sends the state from the representative lookup as a hint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/lookup')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ normalized_input: { line1: '1100 Congress Ave', state: 'TX' }, representatives: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return new Promise(() => {})
    })

    render(<AddressLookup />)
    fireEvent.change(screen.getByLabelText(/Street address/i), {
      target: { value: '1100 Congress Ave, Austin, TX 78701' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /Voting Locations/i }))

    const call = fetchSpy.mock.calls.find(([u]) => String(u).includes('/api/voter-info'))
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      address: '1100 Congress Ave, Austin, TX 78701',
      state: 'TX',
    })
  })
})
