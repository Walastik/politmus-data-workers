import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiClient } from './api'

afterEach(() => vi.unstubAllGlobals())

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('createApiClient', () => {
  it('joins the base URL and path', () => {
    const api = createApiClient({ baseUrl: 'https://politmus.com/' })
    expect(api.url('/api/feed')).toBe('https://politmus.com/api/feed')
    expect(api.url('api/feed')).toBe('https://politmus.com/api/feed')
    expect(createApiClient({ baseUrl: '' }).url('/api/feed')).toBe('/api/feed')
  })

  it('sends the session token as a bearer header', async () => {
    const fetchMock = stubFetch()
    const api = createApiClient({ baseUrl: '', getToken: async () => 'tok' })
    await api.fetch('/api/bills', { headers: { Accept: 'application/json' } })
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('still sends the request when there is no session or the token fails', async () => {
    const fetchMock = stubFetch()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await createApiClient({ baseUrl: '', getToken: async () => null }).fetch('/api/feed')
    await createApiClient({
      baseUrl: '',
      getToken: async () => {
        throw new Error('offline')
      },
    }).fetch('/api/feed')
    for (const [, init] of fetchMock.mock.calls) {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    }
  })
})
