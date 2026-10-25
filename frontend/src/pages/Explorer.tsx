import { Landmark, MapPin, MapPinHouse, Radio, Rss, ScrollText, Search, Sparkles, Users, Vote } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { SignInButton, UserButton, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'

import CandidatesPanel from '../components/CandidatesPanel'
import HappeningNow from '../components/HappeningNow'
import LocationSettings from '../components/LocationSettings'
import ScoreHeadline from '../components/ScoreHeadline'
import PositionsProgressPanel from '../components/PositionsProgressPanel'

import AddressLookup, { type AddressRequest } from '../AddressLookup'
import { apiUrl } from '../api'
import BillDrawer from '../BillDrawer'
import BillsFeed from '../BillsFeed'
import MemberDrawer from '../MemberDrawer'
import { useExplorerLinks } from '../useExplorerLinks'
import { useSavedAddress } from '../useSavedAddress'
import {
  PARTY_FILTERS,
  ROSTER_STATUS_FILTERS,
  STATE_OPTIONS,
  officeLine,
  officialName,
  partyBadgeClass,
  partyShort,
  positionsStatusLabel,
  rosterStatusLabel,
  type Official,
  type RosterStatusFilter,
} from '../types'

export default function Explorer() {
  const {
    tab,
    setTab,
    official: selectedOfficial,
    openOfficial,
    closeOfficial,
    bill: selectedBill,
    openBill,
    closeBill,
  } = useExplorerLinks()
  const [officials, setOfficials] = useState<Official[]>([])
  const [filterParty, setFilterParty] = useState('')
  const [filterStatus, setFilterStatus] = useState<RosterStatusFilter>('active')
  const [filterState, setFilterState] = useState('')
  const [nameQuery, setNameQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasPositionsOnly, setHasPositionsOnly] = useState(false)
  const { isSignedIn } = useAuth()
  const { savedAddress } = useSavedAddress()
  const [savedAddressRequest, setSavedAddressRequest] = useState(0)
  const [addressRequest, setAddressRequest] = useState<AddressRequest | null>(null)
  // Lookup stays mounted after its first visit, so switching tabs keeps its
  // results instead of re-running the lookup.
  const [lookupVisited, setLookupVisited] = useState(tab === 'lookup')
  if (tab === 'lookup' && !lookupVisited) {
    setLookupVisited(true)
  }
  // Happening Now stays mounted too, so coming back doesn't refetch its data.
  const [nowVisited, setNowVisited] = useState(tab === 'now')
  if (tab === 'now' && !nowVisited) {
    setNowVisited(true)
  }
  const visibleOfficials =
    isSignedIn && hasPositionsOnly
      ? officials.filter((official) => official.positions_status === 'ok')
      : officials

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(nameQuery.trim())
    }, 200)
    return () => window.clearTimeout(timeout)
  }, [nameQuery])

  useEffect(() => {
    if (tab !== 'roster') {
      return
    }

    const controller = new AbortController()
    const params = new URLSearchParams()
    if (filterStatus === 'active') {
      params.set('current_member', 'true')
    } else if (filterStatus === 'former') {
      params.set('current_member', 'false')
    }
    params.set('level', 'federal')
    if (filterParty) {
      params.set('party', filterParty)
    }
    if (filterState) {
      params.set('state', filterState)
    }
    if (debouncedQuery) {
      params.set('q', debouncedQuery)
    }
    const query = params.toString()
    const url = query ? apiUrl(`/api/officials?${query}`) : apiUrl('/api/officials')

    setError(null)
    setLoading(true)

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load officials (${res.status})`)
        }
        return res.json() as Promise<Official[]>
      })
      .then((data) => {
        setOfficials(Array.isArray(data) ? data : [])
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        console.error(err)
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load congressional roster',
        )
        setOfficials([])
        setLoading(false)
      })

    return () => controller.abort()
  }, [debouncedQuery, filterParty, filterState, filterStatus, tab])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8">
      <header className="mx-auto mb-8 max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Landmark className="mt-1 h-7 w-7 text-blue-400" aria-hidden="true" />
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Politmus Explorer</h1>
              <p className="mt-1 text-sm text-slate-400">
                What's happening in your election, plus address lookup, roster, candidates and bills
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <nav className="flex flex-wrap gap-2" aria-label="Primary">
              {savedAddress ? (
                <TabButton
                  active={false}
                  icon={<MapPinHouse className="h-3.5 w-3.5" />}
                  label="My Representatives"
                  title={savedAddress}
                  onClick={() => {
                    if (tab !== 'lookup') {
                      setTab('lookup')
                    }
                    setSavedAddressRequest((request) => request + 1)
                  }}
                />
              ) : null}
              <TabButton
                active={tab === 'now'}
                icon={<Radio className="h-3.5 w-3.5" />}
                label="Happening Now"
                onClick={() => setTab('now')}
              />
              <TabButton
                active={tab === 'lookup'}
                icon={<MapPin className="h-3.5 w-3.5" />}
                label="Lookup"
                onClick={() => setTab('lookup')}
              />
              <TabButton
                active={tab === 'roster'}
                icon={<Users className="h-3.5 w-3.5" />}
                label="Roster"
                onClick={() => setTab('roster')}
              />
              <TabButton
                active={tab === 'candidates'}
                icon={<Vote className="h-3.5 w-3.5" />}
                label="Candidates"
                onClick={() => setTab('candidates')}
              />
              <TabButton
                active={tab === 'bills'}
                icon={<ScrollText className="h-3.5 w-3.5" />}
                label="Bills"
                onClick={() => setTab('bills')}
              />
              <SignedIn>
                <Link
                  to="/feed"
                  className="inline-flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 transition hover:bg-slate-700"
                >
                  <Rss className="h-3.5 w-3.5" />
                  Feed
                </Link>
              </SignedIn>
            </nav>
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
                <button className="rounded bg-slate-800 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 transition hover:bg-slate-700">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>
          </div>
        </div>

        {tab === 'roster' ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Status
              </span>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter by member status"
              >
                {ROSTER_STATUS_FILTERS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilterStatus(value)}
                    className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                      filterStatus === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Party
              </span>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter by party"
              >
              {PARTY_FILTERS.map(({ value, label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFilterParty(value)}
                  className={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                    filterParty === value
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
              </div>
              <SignedIn>
                <button
                  type="button"
                  onClick={() => setHasPositionsOnly(!hasPositionsOnly)}
                  aria-pressed={hasPositionsOnly}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition sm:ml-2 ${
                    hasPositionsOnly
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-800 text-purple-300 hover:bg-slate-700'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Has AI positions
                </button>
              </SignedIn>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block min-w-0 flex-1">
                <span className="sr-only">Search members by name</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={nameQuery}
                  onChange={(event) => setNameQuery(event.target.value)}
                  placeholder="Search by name"
                  className="w-full rounded border border-slate-700 bg-slate-800 py-2 pr-3 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="sm:w-64">
                <span className="sr-only">Filter by state</span>
                <select
                  value={filterState}
                  onChange={(event) => setFilterState(event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">All states</option>
                  {STATE_OPTIONS.map((state) => (
                    <option key={state.abbr} value={state.abbr}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl">
        {lookupVisited ? (
          <div hidden={tab !== 'lookup'}>
            <AddressLookup
              onSelectOfficial={openOfficial}
              savedAddressRequest={savedAddressRequest}
              addressRequest={addressRequest}
            />
          </div>
        ) : null}
        {nowVisited ? (
          <div hidden={tab !== 'now'}>
            <HappeningNow
              onSelectOfficial={openOfficial}
              onSeeAllLocations={(address) => {
                setAddressRequest((request) => ({
                  id: (request?.id ?? 0) + 1,
                  address,
                  view: 'voting',
                }))
                setTab('lookup')
              }}
              onSeeCandidates={() => setTab('candidates')}
            />
          </div>
        ) : null}
        {tab === 'lookup' || tab === 'now' ? null : tab === 'bills' ? (
          <BillsFeed onSelectBill={openBill} />
        ) : tab === 'candidates' ? (
          <CandidatesPanel onSelectOfficial={openOfficial} />
        ) : (
          <>
            <SignedIn>
              <PositionsProgressPanel onSelectOfficial={openOfficial} />
            </SignedIn>
            {loading ? (
              <p className="text-slate-400">Loading congressional roster...</p>
            ) : error ? (
              <p className="text-red-400">
                {error}. Check that the API is reachable and refresh.
              </p>
            ) : visibleOfficials.length === 0 ? (
              <p className="text-slate-400">No officials match this filter.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-400">
                  Showing {visibleOfficials.length} member{visibleOfficials.length === 1 ? '' : 's'}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {visibleOfficials.map((official) => (
                    <button
                      key={official.id}
                      type="button"
                      onClick={() => openOfficial(official)}
                      className="rounded-lg border border-slate-700 bg-slate-800 p-4 text-left shadow-sm transition hover:border-slate-500 hover:bg-slate-800/80"
                    >
                      <div className="flex items-start justify-between">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-bold ${partyBadgeClass(official.party)}`}
                        >
                          {partyShort(official.party)}
                        </span>
                        <span className="text-xs text-slate-400">{official.state}</span>
                      </div>
                      <h3 className="mt-2 text-base font-semibold">{officialName(official)}</h3>
                      <p className="mt-1 text-xs text-slate-400">
                        {officeLine(official)}
                      </p>
                      {filterStatus !== 'active' ? (
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {rosterStatusLabel(official)}
                        </p>
                      ) : null}
                      <SignedIn>
                        <ScoreHeadline
                          points={official.score_points}
                          pct={official.score_pct}
                          matches={official.score_matches}
                        />
                        <PositionsCardBadge official={official} />
                      </SignedIn>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {selectedOfficial ? (
        <MemberDrawer
          official={selectedOfficial}
          onClose={closeOfficial}
          selectedBill={selectedBill}
          onSelectBill={openBill}
          onCloseBill={closeBill}
        />
      ) : selectedBill ? (
        <BillDrawer bill={selectedBill} onClose={closeBill} />
      ) : null}
    </div>
  )
}

function PositionsCardBadge({ official }: { official: Official }) {
  if (official.positions_status === 'ok') {
    return (
      <span className="mt-2 inline-flex items-center gap-1 rounded border border-purple-500/40 bg-purple-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-purple-200">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        AI positions ({official.positions_count ?? 0})
      </span>
    )
  }
  const label = positionsStatusLabel(official.positions_status)
  return label ? (
    <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
  ) : null
}

function TabButton({
  active,
  icon,
  label,
  title,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
