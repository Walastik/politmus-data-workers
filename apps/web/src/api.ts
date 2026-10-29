import { createApiClient } from '@politmus/core/api'

declare global {
  interface Window {
    // ClerkProvider mounts the Clerk instance on window
    Clerk?: { session?: { getToken: () => Promise<string | null> } | null }
  }
}

const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken: async () => window.Clerk?.session?.getToken() ?? null,
})

export const apiFetch = api.fetch
export const apiJson = api.json
