import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import AddressLookup from './AddressLookup'

type MockUser = {
  unsafeMetadata: Record<string, unknown>
  update: (params: { unsafeMetadata: Record<string, unknown> }) => Promise<void>
}

const clerk = vi.hoisted(() => ({ user: null as MockUser | null }))

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => ({ user: clerk.user, isLoaded: true }),
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

    render(<AddressLookup onSelectOfficial={() => {}} />)

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

    render(<AddressLookup onSelectOfficial={() => {}} />)
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

    render(<AddressLookup onSelectOfficial={() => {}} />)
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

    render(<AddressLookup onSelectOfficial={() => {}} />)

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

    render(<AddressLookup onSelectOfficial={() => {}} />)
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

describe('AddressLookup: use my location', () => {
  const jsonResponse = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

  const austinLookup = {
    normalized_input: { line1: null, city: null, state: 'TX', zip: null },
    divisions: [],
    representatives: [
      {
        id: 1,
        name: 'Jane Doe',
        office: 'Representative',
        division_id: 'ocd-division/country:us/state:tx/cd:10',
        division_name: 'Congressional District 10',
        levels: ['country'],
        roles: ['legislatorLowerBody'],
        party: 'Independent',
        phones: [],
        urls: [],
        addresses: [],
      },
    ],
  }

  const photonFeature = {
    geometry: { coordinates: [-97.74312, 30.26721] },
    properties: {
      countrycode: 'US',
      housenumber: '1100',
      street: 'Congress Avenue',
      city: 'Austin',
      state: 'Texas',
      postcode: '78701',
    },
  }

  function mockGeolocation(
    impl: (success: PositionCallback, failure: PositionErrorCallback) => void,
  ) {
    const getCurrentPosition = vi.fn(impl)
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    })
    return getCurrentPosition
  }

  function succeedWith(lat: number, lon: number) {
    return mockGeolocation((success) =>
      success({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition),
    )
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    // jsdom has no geolocation; remove the stub so other tests see the default.
    delete (navigator as { geolocation?: unknown }).geolocation
  })

  it('hides the button when the browser has no geolocation', () => {
    render(<AddressLookup onSelectOfficial={() => {}} />)
    expect(screen.queryByRole('button', { name: /Use my location/i })).toBeNull()
  })

  it('looks up representatives by rounded coordinates and fills in the nearby address', async () => {
    succeedWith(30.267213456, -97.743124567)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('photon.komoot.io/reverse')) return jsonResponse({ features: [photonFeature] })
      if (url.includes('/api/lookup')) return jsonResponse(austinLookup)
      return new Promise(() => {})
    })

    render(<AddressLookup onSelectOfficial={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Use my location/i }))

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    const lookupCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/api/lookup'))
    expect(String(lookupCall?.[0])).toContain('/api/lookup?lat=30.26721&lon=-97.74312')
    expect(screen.getByLabelText(/Street address/i)).toHaveValue(
      '1100 Congress Avenue, Austin, Texas, 78701',
    )
    expect(
      screen.getByText(/your current location \(near 1100 Congress Avenue/),
    ).toBeInTheDocument()

    // The reverse-geocoded address feeds the Voting Locations tab.
    fireEvent.click(screen.getByRole('tab', { name: /Voting Locations/i }))
    const voterCall = fetchSpy.mock.calls.find(([u]) => String(u).includes('/api/voter-info'))
    expect(JSON.parse(String(voterCall?.[1]?.body))).toEqual({
      address: '1100 Congress Avenue, Austin, Texas, 78701',
      state: 'TX',
    })
  })

  it('shows a message and makes no lookup when permission is denied', async () => {
    mockGeolocation((_success, failure) =>
      failure({ code: 1, message: 'denied' } as GeolocationPositionError),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    render(<AddressLookup onSelectOfficial={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Use my location/i }))

    expect(await screen.findByText(/Location access was blocked/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Use my location/i })).not.toBeDisabled()
  })

  it('still shows representatives when reverse geocoding fails, without fetching voter info', async () => {
    succeedWith(30.2672, -97.7431)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('photon.komoot.io/reverse')) return Promise.reject(new Error('offline'))
      if (url.includes('/api/lookup')) return jsonResponse(austinLookup)
      return new Promise(() => {})
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<AddressLookup onSelectOfficial={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Use my location/i }))

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('your current location')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Voting Locations/i }))
    expect(screen.getByText(/couldn't find a street address for your location/i)).toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/api/voter-info'))).toBe(false)
  })

  it('lets a typed address submitted while locating win over the location lookup', async () => {
    let resolvePosition: (position: GeolocationPosition) => void = () => {}
    mockGeolocation((success) => {
      resolvePosition = success
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('photon.komoot.io/reverse')) return jsonResponse({ features: [photonFeature] })
      if (url.includes('/api/lookup')) {
        return jsonResponse({
          normalized_input: { line1: '500 Main St', city: 'Dallas', state: 'TX', zip: '75201' },
          divisions: [],
          representatives: [],
        })
      }
      return Promise.reject(new Error('Unknown url'))
    })

    render(<AddressLookup onSelectOfficial={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Use my location/i }))

    // Submit the form directly; the buttons are disabled while locating.
    const input = screen.getByLabelText(/Street address/i)
    fireEvent.change(input, { target: { value: '500 Main St, Dallas, TX' } })
    fireEvent.submit(screen.getByRole('search'))
    expect(await screen.findByText(/500 Main St, Dallas TX 75201/)).toBeInTheDocument()

    resolvePosition({ coords: { latitude: 30.2672, longitude: -97.7431 } } as GeolocationPosition)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Use my location/i })).not.toBeDisabled(),
    )

    const urls = fetchSpy.mock.calls.map(([u]) => String(u))
    expect(urls.some((u) => u.includes('/api/lookup?lat='))).toBe(false)
    expect(urls.some((u) => u.includes('photon.komoot.io/reverse'))).toBe(false)
    expect(input).toHaveValue('500 Main St, Dallas, TX')
  })
})

describe('AddressLookup saved address', () => {
  let lookupAddresses: string[]

  function signIn(savedAddress?: string) {
    const user: MockUser = {
      unsafeMetadata: savedAddress ? { savedAddress } : {},
      update: vi.fn(async ({ unsafeMetadata }) => {
        user.unsafeMetadata = unsafeMetadata
      }),
    }
    clerk.user = user
    return user
  }

  beforeEach(() => {
    lookupAddresses = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      lookupAddresses.push(url.searchParams.get('address') ?? '')
      return Promise.resolve(
        new Response(
          JSON.stringify({
            normalized_input: { line1: url.searchParams.get('address'), state: 'UT' },
            representatives: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    })
  })

  afterEach(() => {
    clerk.user = null
    vi.restoreAllMocks()
  })

  async function lookUp(address: string) {
    fireEvent.change(screen.getByLabelText(/Street address/i), { target: { value: address } })
    fireEvent.click(screen.getByRole('button', { name: /Find representatives/i }))
    await screen.findByRole('tab', { name: /Representatives/i })
  }

  it('offers to save a looked-up address when signed in without one', async () => {
    const user = signIn()
    render(<AddressLookup onSelectOfficial={() => {}} />)
    await lookUp('1 Main St, Provo, UT')

    fireEvent.click(await screen.findByRole('button', { name: 'Save as my address' }))
    expect(await screen.findByText('Saved as your address')).toBeInTheDocument()
    expect(user.update).toHaveBeenCalledWith({
      unsafeMetadata: { savedAddress: '1 Main St, Provo, UT' },
    })
  })

  it('does not offer to save the address that is already saved', async () => {
    signIn('1 Main St, Provo, UT')
    render(<AddressLookup onSelectOfficial={() => {}} />)
    await screen.findByRole('tab', { name: /Representatives/i })

    expect(screen.queryByRole('button', { name: 'Save as my address' })).not.toBeInTheDocument()
  })

  it('does not offer to save when signed out', async () => {
    render(<AddressLookup onSelectOfficial={() => {}} />)
    await lookUp('1 Main St, Provo, UT')

    expect(screen.queryByRole('button', { name: 'Save as my address' })).not.toBeInTheDocument()
  })

  it('looks up the saved address on load and fills in the address box', async () => {
    signIn('1 Main St, Provo, UT')
    render(<AddressLookup onSelectOfficial={() => {}} />)

    await screen.findByRole('tab', { name: /Representatives/i })
    expect(screen.getByLabelText(/Street address/i)).toHaveValue('1 Main St, Provo, UT')
    expect(lookupAddresses).toEqual(['1 Main St, Provo, UT'])
  })

  it('shows the saved address again on request, without repeating a showing lookup', async () => {
    signIn('1 Main St, Provo, UT')
    const { rerender } = render(<AddressLookup onSelectOfficial={() => {}} />)
    await screen.findByRole('tab', { name: /Representatives/i })

    rerender(<AddressLookup onSelectOfficial={() => {}} savedAddressRequest={1} />)
    expect(lookupAddresses).toEqual(['1 Main St, Provo, UT'])

    await lookUp('9 Elm St, Ogden, UT')
    rerender(<AddressLookup onSelectOfficial={() => {}} savedAddressRequest={2} />)
    await waitFor(() =>
      expect(lookupAddresses).toEqual([
        '1 Main St, Provo, UT',
        '9 Elm St, Ogden, UT',
        '1 Main St, Provo, UT',
      ]),
    )
    expect(screen.getByLabelText(/Street address/i)).toHaveValue('1 Main St, Provo, UT')
  })
})
