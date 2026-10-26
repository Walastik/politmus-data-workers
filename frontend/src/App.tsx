import { SignedIn, SignedOut } from '@clerk/clerk-react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import AppShell from './components/AppShell'
import Bills from './pages/Bills'
import Candidates from './pages/Candidates'
import Congress from './pages/Congress'
import Feed from './pages/Feed'
import Landing from './pages/Landing'
import Now from './pages/Now'
import Reps from './pages/Reps'
import { CivicLocationProvider } from './useCivicLocation'

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export function AppRoutes() {
  return (
    <CivicLocationProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          <Route path="/now" element={<Now />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/reps" element={<Reps />} />
          <Route path="/congress" element={<Congress />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/candidates" element={<Candidates />} />
        </Route>
        <Route path="/dev-explorer" element={<LegacyExplorerRedirect />} />
        <Route path="/landing" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </CivicLocationProvider>
  )
}

// Signed-in visitors start on Happening Now; everyone else sees what Politmus is.
function Home() {
  return (
    <>
      <SignedIn>
        <Navigate to="/now" replace />
      </SignedIn>
      <SignedOut>
        <Landing />
      </SignedOut>
    </>
  )
}

const LEGACY_TABS: Record<string, string> = {
  now: '/now',
  lookup: '/reps',
  roster: '/congress?view=list',
  candidates: '/candidates',
  bills: '/bills',
}

// Old /dev-explorer?tab=… links, keeping any open drawer (?official=, ?bill=).
function LegacyExplorerRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  const [path, query] = (LEGACY_TABS[params.get('tab') ?? ''] ?? '/now').split('?')
  const next = new URLSearchParams(query)
  for (const key of ['official', 'bill']) {
    const value = params.get(key)
    if (value) next.set(key, value)
  }
  const nextSearch = next.toString()
  return <Navigate to={`${path}${nextSearch ? `?${nextSearch}` : ''}`} replace />
}
