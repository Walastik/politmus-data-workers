import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clerkState, currentUrl, jsonResponse, renderApp, resetClerkState } from './testUtils'
import type { CivicLookup, CivicRepresentative } from './types'

vi.mock('@clerk/clerk-react', async () => (await import('./clerkMock')).clerkMock())

function rep(id: string, name: string, office: string, extra: Partial<CivicRepresentative> = {}): CivicRepresentative {
  return {
    id,
    name,
    office,
    division_id: 'ocd-division/country:us/state:ut',
    division_name: 'Utah',
    party: 'Republican',
    levels: ['country'],
    roles: [office === 'Senator' ? 'legislatorUpperBody' : 'legislatorLowerBody'],
    phones: ['(202) 555-0100'],
    emails: [],
    urls: [],
    photo_url: null,
    addresses: [],
    channels: [],
    ...extra,
  }
}

const lookup: CivicLookup = {
  normalized_input: { line1: '1 Main St', line2: null, line3: null, city: 'Provo', state: 'UT', zip: '84601' },
  point: null,
  divisions: [],
  representatives: [
    rep('L000577', 'Mike Lee', 'Senator', { score_points: 4, score_pct: 80, score_matches: 6 }),
    rep('C001114', 'John Curtis', 'Senator'),
    rep('K000403', 'Mike Kennedy', 'Representative', {
      division_id: 'ocd-division/country:us/state:ut/cd:3',
      division_name: 'Congressional District 3',
    }),
    rep('UT-GOV', 'Spencer Cox', 'Governor', { levels: ['administrativeArea1'], roles: [] }),
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/lookup')) return jsonResponse(lookup)
    if (url.includes('/finance')) {
      return jsonResponse({ official_id: 'L000577', fec_candidate_ids: [], source: 'FEC', elections: [] })
    }
    if (url === '/api/officials/L000577') {
      return jsonResponse({
        id: 'L000577',
        name: 'Lee, Mike',
        display_name: 'Mike Lee',
        state: 'Utah',
        party: 'Republican',
        office: 'Senator',
        district: null,
        current_member: true,
        phone: null,
        office_address: null,
        website_url: null,
        votes: [],
        stated_positions: [],
        positions_sync: null,
      })
    }
    if (url.startsWith('/api/feed')) return jsonResponse({ items: [], next_cursor: null, elections: [] })
    if (url.startsWith('/api/candidates/races')) return jsonResponse({ total_count: 0, items: [] })
    if (url.startsWith('/api/voter-info')) return jsonResponse({ detail: 'unavailable' }, 503)
    if (url.includes('photon.komoot.io/reverse')) {
      return jsonResponse({
        features: [
          {
            properties: { countrycode: 'US', housenumber: '1', street: 'Main St', city: 'Provo', state: 'UT', postcode: '84601' },
            geometry: { coordinates: [-111.65, 40.23] },
          },
        ],
      })
    }
    if (url.includes('photon.komoot.io')) return jsonResponse({ features: [] })
    return jsonResponse([])
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  resetClerkState()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  // @ts-expect-error -- tests add and remove a fake geolocation
  delete navigator.geolocation
  // @ts-expect-error -- and a fake permissions API
  delete navigator.permissions
})

function lookupUrls() {
  return fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith('/api/lookup'))
}

function mockGeolocation(
  getCurrentPosition: (success: PositionCallback, error: PositionErrorCallback) => void,
  permission: PermissionState = 'prompt',
) {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } })
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.resolve({ state: permission }) },
  })
}

function at(lat: number, lon: number) {
  return (success: PositionCallback) => success({ coords: { latitude: lat, longitude: lon } } as GeolocationPosition)
}

describe('routes', () => {
  it('shows signed-out visitors the landing page', () => {
    clerkState.signedIn = false
    renderApp('/')
    expect(screen.getByRole('heading', { level: 1, name: 'Politmus' })).toBeInTheDocument()
    expect(screen.getByText('See who represents you')).toBeInTheDocument()
  })

  it('sends signed-in visitors to Happening Now', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Happening Now' })).toBeInTheDocument()
    expect(currentUrl.pathname).toBe('/now')
  })

  it('redirects old explorer links and keeps the open drawer', () => {
    renderApp('/dev-explorer?tab=roster&official=A1')
    expect(currentUrl.pathname).toBe('/congress')
    expect(currentUrl.search).toBe('?view=list&official=A1')
  })

  it('redirects the old lookup tab to My Reps', () => {
    renderApp('/dev-explorer?tab=lookup')
    expect(currentUrl.pathname).toBe('/reps')
  })

  it('marks the current page in the nav', async () => {
    renderApp('/congress')
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: /Congress/ })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Feed/ })).not.toHaveAttribute('aria-current')
  })
})

describe('My Reps', () => {
  it('asks for an address, then shows Congress and state officials with scores', async () => {
    clerkState.signedIn = false
    renderApp('/reps')

    expect(await screen.findByText(/to see who represents you/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '1 Main St, Provo, UT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find my representatives' }))

    const washington = (await screen.findByRole('heading', { name: 'In Washington' })).closest('section')!
    expect(within(washington).getByText('Mike Lee')).toBeInTheDocument()
    expect(within(washington).getByText('80%')).toBeInTheDocument()
    expect(within(washington).getByText(/Representative · Congressional District 3/)).toBeInTheDocument()
    const state = screen.getByRole('heading', { name: 'In Utah' }).closest('section')!
    expect(within(state).getByText('Spencer Cox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in to save this address' })).toBeInTheDocument()
  })

  it('opens a full profile in the drawer', async () => {
    clerkState.savedAddress = '1 Main St, Provo, UT'
    renderApp('/reps')

    fireEvent.click(await screen.findByRole('button', { name: 'Full profile: Mike Lee' }))
    expect(currentUrl.search).toBe('?official=L000577')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('shares one lookup with Happening Now', async () => {
    clerkState.savedAddress = '1 Main St, Provo, UT'
    renderApp('/reps')
    await screen.findByText('Mike Lee')

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: /Happening Now/ }))
    expect(await screen.findByRole('heading', { name: /Who represents you/i })).toBeInTheDocument()
    expect(lookupUrls()).toHaveLength(1)
  })
})

describe('saved address', () => {
  it('offers to save a typed address when signed in', async () => {
    renderApp('/reps')
    fireEvent.change(await screen.findByLabelText('Street address'), { target: { value: '1 Main St, Provo, UT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find my representatives' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Save as my address' }))
    await vi.waitFor(() => expect(clerkState.savedAddress).toBe('1 Main St, Provo, UT'))
  })

  it('does not offer to save the address that is already saved', async () => {
    clerkState.savedAddress = '1 Main St, Provo, UT'
    renderApp('/reps')
    await screen.findByText('Mike Lee')
    expect(screen.queryByRole('button', { name: 'Save as my address' })).not.toBeInTheDocument()
  })

  it('remembers a typed address on this device', async () => {
    window.localStorage.setItem('politmus:address', '1 Main St, Provo, UT')
    clerkState.signedIn = false
    renderApp('/reps')
    expect(await screen.findByText('Mike Lee')).toBeInTheDocument()
    expect(lookupUrls()[0]).toContain('address=1%20Main%20St%2C%20Provo%2C%20UT')
  })
})

describe('device location', () => {
  it('looks up by rounded coordinates and shows the nearby address', async () => {
    mockGeolocation(at(40.2338456, -111.6585123))
    renderApp('/reps')

    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Mike Lee')).toBeInTheDocument()
    expect(lookupUrls()[0]).toBe('/api/lookup?lat=40.23385&lon=-111.65851')
    expect(screen.getByText('your current location (near 1 Main St, Provo, UT, 84601)')).toBeInTheDocument()
  })

  it('uses the location without asking when the browser already allows it', async () => {
    mockGeolocation(at(40.2338456, -111.6585123), 'granted')
    clerkState.signedIn = false
    renderApp('/reps')

    expect(await screen.findByText('Mike Lee')).toBeInTheDocument()
    expect(lookupUrls()[0]).toContain('lat=40.23385')
  })

  it('shows a message and makes no lookup when permission is denied', async () => {
    mockGeolocation((_success, error) => error({ code: 1 } as GeolocationPositionError))
    renderApp('/reps')

    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Location access was blocked. Enter your address instead.')).toBeInTheDocument()
    expect(lookupUrls()).toHaveLength(0)
  })

  it('lets an address typed while locating win', async () => {
    let resolvePosition: (() => void) | null = null
    mockGeolocation((success) => {
      resolvePosition = () => at(40, -111)(success)
    })
    renderApp('/reps')

    fireEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    fireEvent.change(screen.getByLabelText('Street address'), { target: { value: '1 Main St, Provo, UT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find my representatives' }))
    expect(await screen.findByText('Mike Lee')).toBeInTheDocument()

    resolvePosition!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(lookupUrls()).toHaveLength(1)
    expect(screen.getByText('1 Main St, Provo, UT')).toBeInTheDocument()
  })
})

describe('Candidates', () => {
  it('lists races on its own page', async () => {
    renderApp('/candidates')
    expect(await screen.findByText('No races match this filter.')).toBeInTheDocument()
  })
})
