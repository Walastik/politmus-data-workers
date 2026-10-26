import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { AppRoutes } from './App'

export { clerkState, resetClerkState } from './clerkMock'

// The URL the app is on, for asserting navigation.
export const currentUrl = { pathname: '', search: '' }

function UrlSpy() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    currentUrl.pathname = pathname
    currentUrl.search = search
  }, [pathname, search])
  return null
}

// Renders the whole routed app (shell, drawers, shared location) at `url`.
export function renderApp(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
      <UrlSpy />
    </MemoryRouter>,
  )
}

export function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}
