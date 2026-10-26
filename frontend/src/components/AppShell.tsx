import { SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from '@clerk/clerk-react'
import { Landmark, MapPin, MapPinHouse, Radio, Rss, ScrollText, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import BillDrawer from '../BillDrawer'
import MemberDrawer from '../MemberDrawer'
import { useDrawerLinks } from '../useDrawerLinks'
import LocationSettings from './LocationSettings'

export const NAV_ITEMS: { to: string; label: string; short: string; icon: LucideIcon }[] = [
  { to: '/now', label: 'Happening Now', short: 'Now', icon: Radio },
  { to: '/feed', label: 'Feed', short: 'Feed', icon: Rss },
  { to: '/reps', label: 'My Reps', short: 'My Reps', icon: MapPinHouse },
  { to: '/congress', label: 'Congress', short: 'Congress', icon: Landmark },
  { to: '/bills', label: 'Bills', short: 'Bills', icon: ScrollText },
]

// Every page sits inside this: the top bar (bottom tabs on phones), the
// account menu, and the member/bill drawers that any page can open via the URL.
export default function AppShell() {
  const { official, closeOfficial, bill, openBill, closeBill } = useDrawerLinks()

  return (
    <div className="min-h-screen bg-slate-900 pb-16 text-slate-100 md:pb-0">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-50">
            <Landmark className="h-5 w-5 text-blue-400" aria-hidden="true" />
            Politmus
          </NavLink>
          <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 md:flex">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                  }`
                }
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SignedIn>
              <UserButton>
                <UserButton.UserProfilePage
                  label="Location Settings"
                  url="location"
                  labelIcon={<MapPin className="h-4 w-4" />}
                >
                  <LocationSettings />
                </UserButton.UserProfilePage>
              </UserButton>
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button
                  type="button"
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Sign up
                </button>
              </SignUpButton>
            </SignedOut>
          </div>
        </div>
      </header>

      <Outlet />

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-900/95 backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV_ITEMS.map(({ to, short, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition ${
                    isActive ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
                  }`
                }
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {short}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {official ? (
        <MemberDrawer
          official={official}
          onClose={closeOfficial}
          selectedBill={bill}
          onSelectBill={openBill}
          onCloseBill={closeBill}
        />
      ) : bill ? (
        <BillDrawer bill={bill} onClose={closeBill} />
      ) : null}
    </div>
  )
}
