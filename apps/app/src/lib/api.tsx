import { useAuth } from '@clerk/expo'
import { createApiClient, type ApiClient } from '@politmus/core/api'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

const ApiContext = createContext<ApiClient | null>(null)

// Every request carries the signed-in user's Clerk token, like the web app.
export function ApiProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth()
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.EXPO_PUBLIC_API_URL ?? '', getToken }),
    [getToken],
  )
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi must be used inside <ApiProvider>')
  return api
}
