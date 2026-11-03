import { SignedIn, SignedOut } from '@clerk/clerk-react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import AppShell from './components/AppShell'
import Bills from './pages/Bills'
import Candidates from './pages/Candidates'
import Congress from './pages/Congress'
import Feed from './pages/Feed'
import Landing from './pages/Landing'
import { PrivacyPolicy, TermsOfService } from './pages/Legal'
import Now from './pages/Now'
import Reps from './pages/Reps'
import WipLanding from './pages/WipLanding'
import { HOME_PATH } from './homePath'
import { legacyExplorerPath } from '@politmus/core/site'
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
        {HOME_PATH !== '/' ? <Route path="/" element={<WipLanding />} /> : null}
        <Route element={<AppShell />}>
          <Route path={HOME_PATH} element={<Home />} />
          <Route path="/now" element={<Now />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/reps" element={<Reps />} />
          <Route path="/congress" element={<Congress />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
        </Route>
        <Route path="/dev-explorer" element={<LegacyExplorerRedirect />} />
        <Route path="/landing" element={<Navigate to={HOME_PATH} replace />} />
        <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
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

// Old /dev-explorer?tab=… links, keeping any open drawer (?official=, ?bill=).
function LegacyExplorerRedirect() {
  const { search } = useLocation()
  return <Navigate to={legacyExplorerPath(search)} replace />
}
