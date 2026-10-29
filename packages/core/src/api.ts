export interface ApiClientOptions {
  // '' means same origin (web behind nginx or the Vite proxy). Native apps
  // pass the public site URL, since the API itself has no public address.
  baseUrl: string
  // Clerk session token; Clerk's useAuth().getToken on web and native.
  getToken?: () => Promise<string | null | undefined>
}

export interface ApiClient {
  url: (path: string) => string
  fetch: (path: string, init?: RequestInit) => Promise<Response>
}

export function createApiClient({ baseUrl, getToken }: ApiClientOptions): ApiClient {
  const base = baseUrl.replace(/\/$/, '')
  const url = (path: string) => `${base}${path.startsWith('/') ? path : `/${path}`}`

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    try {
      const token = await getToken?.()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    } catch (err) {
      console.error('Error fetching Clerk token', err)
    }
    return fetch(url(path), { ...init, headers })
  }

  return { url, fetch: apiFetch }
}
