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
  // Parsed body; throws the API's `detail` (or the status) when not ok.
  json: <T>(path: string, init?: RequestInit) => Promise<T>
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

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await apiFetch(path, init)
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // fall through to the status check
    }
    if (!response.ok) {
      const detail = body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : null
      throw new Error(typeof detail === 'string' && detail ? detail : `Request failed (${response.status})`)
    }
    return body as T
  }

  return { url, fetch: apiFetch, json }
}
